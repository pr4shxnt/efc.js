import http from 'node:http';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import cluster from 'node:cluster';
import os from 'node:os';
import path from 'node:path';
import type { EFCConfig, MountedRoute } from './types.js';
import { scanDir } from './router/scan.js';
import { mountRoutes } from './router/mount.js';
import { runMaster, shutdownMaster } from './cluster/index.js';
import { configureAuth } from './auth/index.js';
import { HttpError } from './errors.js';
import { connectMongo } from './db/mongo.js';
import { setDbClient } from './db/index.js';
import { scanTasks } from './tasks/scanner.js';
import { initBullMQ } from './tasks/bullmq-backend.js';
import { generateDashboard } from './dashboard.js';

function detectDatabase(url?: string): 'mongodb' | 'postgresql' | undefined {
  if (!url) return undefined;
  if (url.startsWith('mongodb')) return 'mongodb';
  if (url.startsWith('postgres')) return 'postgresql';
  return undefined;
}

export async function ignite(config: EFCConfig): Promise<http.Server | undefined> {
  const {
    port: _port,
    workers,
    globalMiddlewares = [],
    onWorkerReady,
    onWorkerCrash,
    onError,
  } = config;

  // Resolve api/tasks dirs from convention. argv[1]-based resolution is unreliable in tsx watch
  // + cluster workers (argv[1] can point to the tsx binary instead of the user's script), so we
  // probe multiple candidates and use the first that exists on disk.
  function resolveConventionDir(name: string): string {
    const candidates: string[] = [
      ...(process.argv[1] ? [path.join(path.dirname(process.argv[1]), name)] : []),
      path.join(process.cwd(), 'src', name),
      path.join(process.cwd(), name),
      path.join(process.cwd(), 'dist', name),
    ];
    return candidates.find((c) => fs.existsSync(c)) ?? candidates[0]!;
  }
  const apiDir = resolveConventionDir('api');
  const tasksDir = resolveConventionDir('tasks');
  const basePath = config.basePath ?? '/v1/api';

  function readProjectMeta(): { name: string; version: string } {
    try {
      const raw = fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8');
      const pkg = JSON.parse(raw) as { name?: string; version?: string };
      return { name: pkg.name ?? 'API', version: pkg.version ?? '' };
    } catch {
      return { name: 'API', version: '' };
    }
  }

  const envPort = process.env['PORT'] != null ? Number(process.env['PORT']) : NaN;
  const port =
    _port != null && !Number.isNaN(_port) ? _port : !Number.isNaN(envPort) ? envPort : 3000;
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  const database = config.database ?? detectDatabase(databaseUrl);
  const jwtSecret = config.jwtSecret ?? process.env['JWT_SECRET'];
  const authStrategy = config.authStrategy ?? 'http-only';
  const clusterEnabled = config.cluster ?? process.env['NODE_ENV'] === 'production';

  if (clusterEnabled && cluster.isPrimary) {
    runMaster({
      workers: workers ?? os.cpus().length,
      ...(onWorkerReady !== undefined && { onWorkerReady }),
      ...(onWorkerCrash !== undefined && { onWorkerCrash }),
    });
    return;
  }

  const app = express();

  const corsOption = config.cors ?? true;
  if (corsOption !== false) {
    const envOrigins = process.env['CORS_ORIGINS'];
    let origin: string | string[] | boolean;
    if (envOrigins) {
      const list = envOrigins
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
      origin = list; // always array so cors validates against the request Origin
    } else if (typeof corsOption === 'object' && corsOption.origin !== undefined) {
      origin = corsOption.origin;
    } else {
      origin = true;
    }
    const corsOpts = typeof corsOption === 'object' ? { ...corsOption, origin } : { origin };
    app.use(cors(corsOpts));
  }

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  for (const mw of globalMiddlewares) {
    app.use(mw);
  }

  // Pre-Flight step 1: Connect database
  if (database === 'mongodb' && databaseUrl) {
    const conn = await connectMongo(databaseUrl);
    setDbClient(conn as unknown as Record<string, unknown>);
  }

  // Pre-Flight step 2: Configure auth
  if (jwtSecret) {
    const cookieDomain = process.env['COOKIE_DOMAIN'];
    configureAuth({
      secret: jwtSecret,
      strategy: authStrategy,
      expiresIn: process.env['JWT_EXPIRES_IN'] ?? '7d',
      ...(cookieDomain !== undefined && { cookieDomain }),
    });
  }

  // Pre-Flight step 3: Scan and register tasks
  if (tasksDir) {
    await scanTasks(tasksDir);
  }

  // Pre-Flight step 4: Start task queue backend
  if (config.tasks) {
    if (config.tasks.backend === 'bullmq') {
      await initBullMQ({
        redisUrl: config.tasks.redisUrl ?? 'redis://localhost:6379',
        concurrency: config.tasks.concurrency ?? 5,
      });
    }
  }

  // Pre-Flight step 5: Scan routes and mount
  const routes = scanDir(apiDir);
  const apiRouter = express.Router();
  const mounted: MountedRoute[] = await mountRoutes(apiRouter, routes);
  app.use(basePath, apiRouter);

  if (config.dashboard !== false && process.env['NODE_ENV'] === 'development') {
    app.get('/', (_req, res) => {
      const { name, version } = readProjectMeta();
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(generateDashboard(mounted, basePath, port, name, version));
    });
  }

  if (onError) {
    app.use(onError);
  } else {
    app.use(
      (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        const asHttp = err instanceof Error && 'statusCode' in err ? (err as HttpError) : null;
        if (asHttp) {
          res
            .status(asHttp.statusCode)
            .json({ error: asHttp.message, statusCode: asHttp.statusCode });
        } else {
          console.error('[EFC] Unhandled error:', err);
          res.status(500).json({ error: 'Internal Server Error', statusCode: 500 });
        }
      },
    );
  }

  return new Promise<http.Server>((resolve, reject) => {
    const server = app.listen(port);

    server.once('listening', () => {
      const wid = (cluster.worker as { id: number } | undefined)?.id ?? 'primary';
      const addr = server.address() as { port: number } | null;
      console.log(`[EFC] Worker ${wid} listening on :${addr?.port ?? port}`);
      resolve(server);
    });

    server.once('error', reject);
  });
}

export function gracefulShutdown(server: http.Server | undefined, timeoutMs = 10_000): void {
  const shutdown = (signal: string) => {
    console.log(`[EFC] ${signal} received — closing server gracefully…`);
    if (server) {
      server.closeIdleConnections();
      server.close(() => {
        console.log('[EFC] Server closed');
        process.exit(0);
      });
      setTimeout(() => {
        console.error('[EFC] Forced exit after timeout');
        process.exit(1);
      }, timeoutMs).unref();
    } else {
      shutdownMaster();
    }
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

export { HttpError } from './errors.js';
export { compose } from './compose.js';
export { db, setDbClient, getDbClient, defineModel } from './db/index.js';
export { scanDir } from './router/scan.js';
export type {
  EFCConfig,
  CorsConfig,
  RouteEntry,
  RouteMeta,
  RouteMethodMeta,
  TaskOptions,
  TaskDefinition,
  DatabaseEngine,
  AuthStrategy,
  ModelSchema,
  ModelCRUD,
} from './types.js';
