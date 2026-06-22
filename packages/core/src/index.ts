import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import cluster from 'node:cluster';
import os from 'node:os';
import type { EFCConfig } from './types.js';
import { scanDir } from './router/scan.js';
import { mountRoutes } from './router/mount.js';
import { runMaster } from './cluster/index.js';
import { configureAuth } from './auth/index.js';
import { HttpError } from './errors.js';
import { connectMongo } from './db/mongo.js';
import { setDbClient } from './db/index.js';
import { scanTasks } from './tasks/scanner.js';
import { initBullMQ } from './tasks/bullmq-backend.js';

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
    apiDir,
    globalMiddlewares = [],
    onWorkerReady,
    onWorkerCrash,
    onError,
  } = config;

  // All runtime values fall back to environment variables
  const port =
    _port != null && !Number.isNaN(_port) ? _port : Number(process.env['PORT']) || 3000;
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
      const list = envOrigins.split(',').map((o) => o.trim()).filter(Boolean);
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
  if (config.tasksDir) {
    await scanTasks(config.tasksDir);
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
  await mountRoutes(app, routes);

  if (onError) {
    app.use(onError);
  } else {
    app.use(
      (
        err: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        const asHttp = err instanceof Error && 'statusCode' in err
          ? (err as HttpError) : null;
        if (asHttp) {
          res.status(asHttp.statusCode).json({ error: asHttp.message, statusCode: asHttp.statusCode });
        } else {
          console.error('[EFC] Unhandled error:', err);
          res.status(500).json({ error: 'Internal Server Error', statusCode: 500 });
        }
      },
    );
  }

  return new Promise<http.Server>((resolve) => {
    const server = app.listen(port, () => {
      const wid = (cluster.worker as { id: number } | undefined)?.id ?? 'primary';
      console.log(`[EFC] Worker ${wid} listening on :${port}`);
      resolve(server);
    });
  });
}

export { HttpError } from './errors.js';
export { compose } from './compose.js';
export { db, setDbClient, getDbClient, defineModel } from './db/index.js';
export { scanDir } from './router/scan.js';
export type {
  EFCConfig,
  CorsConfig,
  RouteEntry,
  TaskOptions,
  TaskDefinition,
  DatabaseEngine,
  AuthStrategy,
  ModelSchema,
  ModelCRUD,
} from './types.js';
