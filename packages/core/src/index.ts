import express from 'express';
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

export async function ignite(config: EFCConfig): Promise<void> {
  const {
    port = 3000,
    cluster: clusterEnabled = true,
    workers,
    apiDir,
    jwtSecret,
    authStrategy = 'http-only',
    globalMiddlewares = [],
    onWorkerReady,
    onWorkerCrash,
    onError,
  } = config;

  if (clusterEnabled && cluster.isPrimary) {
    runMaster({
      workers: workers ?? os.cpus().length,
      ...(onWorkerReady !== undefined && { onWorkerReady }),
      ...(onWorkerCrash !== undefined && { onWorkerCrash }),
    });
    return;
  }

  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  for (const mw of globalMiddlewares) {
    app.use(mw);
  }

  // Pre-Flight step 1: Connect database
  if (config.database === 'mongodb' && config.databaseUrl) {
    const conn = await connectMongo(config.databaseUrl);
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
        if (err instanceof HttpError) {
          res.status(err.statusCode).json({ error: err.message, statusCode: err.statusCode });
        } else {
          console.error('[EFC] Unhandled error:', err);
          res.status(500).json({ error: 'Internal Server Error', statusCode: 500 });
        }
      },
    );
  }

  await new Promise<void>((resolve) => {
    app.listen(port, () => {
      const wid = (cluster.worker as { id: number } | undefined)?.id ?? 'primary';
      console.log(`[EFC] Worker ${wid} listening on :${port}`);
      resolve();
    });
  });
}

export { HttpError } from './errors.js';
export { compose } from './compose.js';
export { db, setDbClient, getDbClient, defineModel } from './db/index.js';
export { scanDir } from './router/scan.js';
export type {
  EFCConfig,
  RouteEntry,
  TaskOptions,
  TaskDefinition,
  DatabaseEngine,
  AuthStrategy,
  ModelSchema,
  ModelCRUD,
} from './types.js';
