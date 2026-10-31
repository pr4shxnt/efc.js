import http from 'node:http';
import fs from 'node:fs';
import express from 'express';
import cluster from 'node:cluster';
import os from 'node:os';
import path from 'node:path';
import type { EFCConfig, MountedRoute } from './types.js';
export type {
  TableModel,
  TableRecord,
  TableCreateInput,
  TableWhere,
  TableWhereUnique,
  TableUpdateData,
  TableCreateData,
  TableUpdateInput,
  TableOrderBy,
  TableSelect,
  TableInclude,
  TableResult,
  Tables,
  TableFindManyArgs,
  TableAggregateArgs,
  TableGroupByArgs,
  TableAggregateResult,
  ScalarFilter,
  StringFilter,
  ListFilter,
  JsonFilter,
  InferTableRecord,
} from './table-types.js';
import { scanDir } from './router/scan.js';
import { mountRoutes } from './router/mount.js';
import { mountOpenAPI } from './openapi.js';
import { attachWebSockets, closeWebSockets } from './websocket.js';
import { runMaster, shutdownMaster } from './cluster/index.js';
import { configureAuth } from './auth/index.js';
import { connectMongo } from './db/mongo.js';
import { setDbClient } from './db/index.js';
import { setDbEngine, setAutoSync } from './db/engine.js';
import { checkConnectionBudget, connectPostgres } from './db/postgres.js';
import { configureLogger, getLogger } from './logger.js';
import { configureQueryLog } from './db/query-log.js';
import { scanTasks } from './tasks/scanner.js';
import { initBullMQ, closeBullMQ } from './tasks/bullmq-backend.js';
import { initPgBoss, closePgBoss } from './tasks/pgboss-backend.js';
import { configureCache, closeCache } from './cache/index.js';
import { servePrimaryCache } from './cache/ipc.js';
import { generateDashboard } from './dashboard.js';
import { createHttpApp, mountErrorHandler } from './http-app.js';

function detectDatabase(url?: string): 'mongodb' | 'postgresql' | undefined {
  if (!url) return undefined;
  if (url.startsWith('mongodb')) return 'mongodb';
  if (url.startsWith('postgres')) return 'postgresql';
  return undefined;
}

export async function ignite(config: EFCConfig): Promise<http.Server | undefined> {
  const { port: _port, workers, onWorkerReady, onWorkerCrash, onError } = config;

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

  const port = _port != null && !Number.isNaN(_port) ? _port : 3000;
  const databaseUrl = config.databaseUrl;
  const database = config.database ?? detectDatabase(databaseUrl);
  const jwtSecret = config.jwtSecret;
  const authStrategy = config.authStrategy ?? 'http-only';
  // NODE_ENV is a Node/Express-wide runtime-mode signal set by the platform, not an app
  // secret — unlike PORT/DATABASE_URL/JWT_SECRET/etc. this one is still read directly.
  const clusterEnabled = config.cluster ?? process.env['NODE_ENV'] === 'production';

  configureLogger(config.logging);
  // Any value but 'http-only' acts as bearer, as it always has — an app may rely on that, so
  // 0.9.x only warns (a typo of 'http-only' silently means no cookie). 1.0 makes it an error.
  if (
    !['http-only', 'bearer', 'localStorage'].includes(authStrategy) &&
    (!clusterEnabled || cluster.isPrimary) // once, not once per worker
  ) {
    getLogger().warn(
      `[EFC] Unknown authStrategy "${String(authStrategy)}" — treated as 'bearer'. Use 'http-only' or 'bearer'; this will be an error in 1.0.`,
    );
  }
  // HS256 with a short secret can be brute-forced offline from any token a user holds.
  if (
    jwtSecret &&
    Buffer.byteLength(jwtSecret) < 32 &&
    process.env['NODE_ENV'] === 'production' &&
    (!clusterEnabled || cluster.isPrimary)
  ) {
    getLogger().warn(
      `[EFC] jwtSecret is ${Buffer.byteLength(jwtSecret)} bytes — use at least 32 random bytes in production (openssl rand -hex 64).`,
    );
  }
  configureQueryLog(config.logging);

  if (clusterEnabled && cluster.isPrimary) {
    // The memory cache lives in the primary so all workers share it (cache/ipc.ts).
    if (config.cache && config.cache.backend === 'memory') {
      servePrimaryCache(config.cache.maxEntries ?? 10_000);
    }
    runMaster({
      workers: workers ?? os.cpus().length,
      ...(onWorkerReady !== undefined && { onWorkerReady }),
      ...(onWorkerCrash !== undefined && { onWorkerCrash }),
    });
    return;
  }

  const app = createHttpApp(config);

  // Pre-Flight step 1: Connect database. The engine decides what defineModel compiles to.
  if (database) setDbEngine(database);
  setAutoSync(config.autoSync ?? true);
  // Pools are per worker; one process per machine reports the machine's total.
  const poolWorkers = clusterEnabled ? (workers ?? os.cpus().length) : 1;
  const reportsPools = !clusterEnabled || cluster.worker?.id === 1;
  if (database === 'mongodb' && databaseUrl) {
    const conn = await connectMongo(databaseUrl, config.databasePool);
    setDbClient(conn as unknown as Record<string, unknown>);
    if (reportsPools) {
      const max = config.databasePool?.max ?? 100; // mongoose's maxPoolSize default
      getLogger().info(
        `MongoDB connections: up to ${poolWorkers * max} from this machine (${poolWorkers} worker(s) × maxPoolSize ${max})`,
      );
    }
  } else if (database === 'postgresql' && databaseUrl) {
    const pool = await connectPostgres(databaseUrl, config.databasePool);
    setDbClient(pool as unknown as Record<string, unknown>);
    if (reportsPools) {
      const max = config.databasePool?.max ?? 10; // node-postgres' default
      // pg-boss on the same database opens its own pool (node-postgres default 10).
      const boss =
        config.tasks && config.tasks.backend === 'pg-boss' && !config.tasks.connectionString
          ? 10
          : 0;
      const breakdown = `${poolWorkers} worker(s) × (pool ${max}${boss ? ` + pg-boss ${boss}` : ''})`;
      await checkConnectionBudget(poolWorkers * (max + boss), breakdown);
    }
  }

  // Pre-Flight step 1b: Cache (also the session-revocation store requireAuth consults)
  if (config.cache) {
    await configureCache(config.cache);
  }

  // Pre-Flight step 2: Configure auth
  if (jwtSecret) {
    configureAuth({
      secret: jwtSecret,
      strategy: authStrategy,
      expiresIn: config.jwtExpiresIn ?? '7d',
      ...(config.cookieDomain !== undefined && { cookieDomain: config.cookieDomain }),
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
        enqueueTimeout: config.tasks.enqueueTimeout ?? 5000,
        queue: config.tasks.queue ?? 'efc',
      });
    } else if (config.tasks.backend === 'pg-boss') {
      const connectionString = config.tasks.connectionString ?? databaseUrl;
      if (!connectionString) {
        throw new Error(
          '[EFC] tasks.backend "pg-boss" needs tasks.connectionString or databaseUrl',
        );
      }
      await initPgBoss({
        connectionString,
        concurrency: config.tasks.concurrency ?? 5,
        enqueueTimeout: config.tasks.enqueueTimeout ?? 5000,
        queue: config.tasks.queue ?? 'efc',
        ...(config.tasks.schema !== undefined && { schema: config.tasks.schema }),
      });
    }
  }

  // Pre-Flight step 5: Scan routes and mount
  const routes = scanDir(apiDir);
  const apiRouter = express.Router();
  const mounted: MountedRoute[] = await mountRoutes(apiRouter, routes);
  if (config.openapi) {
    const meta = readProjectMeta();
    const options = config.openapi === true ? {} : config.openapi;
    await mountOpenAPI(app, mounted, {
      info: { title: meta.name, version: meta.version },
      ...options,
      basePath,
    });
  }
  app.use(basePath, apiRouter);

  if (config.dashboard !== false && process.env['NODE_ENV'] === 'development') {
    app.get('/', (_req, res) => {
      const { name, version } = readProjectMeta();
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(generateDashboard(mounted, basePath, port, name, version));
    });
  }

  mountErrorHandler(app, onError);

  return new Promise<http.Server>((resolve, reject) => {
    const server = http.createServer(app);
    if (config.websocket !== false && mounted.some((route) => route.websocket))
      attachWebSockets(server, app, config.websocket);

    server.once('listening', () => {
      const wid = (cluster.worker as { id: number } | undefined)?.id ?? 'primary';
      const addr = server.address() as { port: number } | null;
      getLogger().info(`Worker ${wid} listening on :${addr?.port ?? port}`);
      resolve(server);
    });

    server.once('error', reject);
    server.listen(port);
  });
}

export function gracefulShutdown(server: http.Server | undefined, timeoutMs = 10_000): void {
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    // A worker can get the signal twice (process-group Ctrl+C plus the primary's
    // forward); the default handler for a repeat would kill it mid-drain.
    if (shuttingDown) return;
    shuttingDown = true;
    getLogger().info(`${signal} received — closing server gracefully…`);
    if (server) {
      const websocketDrain = closeWebSockets(server, Math.max(1, Math.min(1000, timeoutMs / 2)));
      server.closeIdleConnections();
      server.close(() => {
        getLogger().info('Server closed');
        // Let in-flight task jobs finish before exiting; the timeout below still caps it.
        Promise.all([websocketDrain, closeBullMQ(), closePgBoss(), closeCache()])
          .catch((err: unknown) => getLogger().error({ err }, 'Task backend close failed'))
          .finally(() => process.exit(0));
      });
      setTimeout(() => {
        getLogger().error('Forced exit after timeout');
        process.exit(1);
      }, timeoutMs).unref();
    } else {
      shutdownMaster();
      // Workers get the same budget plus a margin before the primary gives up on them.
      setTimeout(() => {
        getLogger().error('Workers did not exit in time — forcing primary exit');
        process.exit(1);
      }, timeoutMs + 2_000).unref();
    }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export { HttpError, isHttpError } from './errors.js';
export { logger, getLogger } from './logger.js';
export { getQueryMetrics, resetQueryMetrics } from './db/query-log.js';
export type { QueryMetric, QueryMetricsSnapshot } from './db/query-log.js';
export { cache } from './cache/index.js';
export { rateLimit } from './rate-limit.js';
export type { RateLimitOptions } from './rate-limit.js';
export { cacheResponse } from './cache/response.js';
export { compose } from './compose.js';
export {
  db,
  setDbClient,
  getDbClient,
  defineModel,
  defineTable,
  defineCollection,
} from './db/index.js';
export type {
  CollectionModel,
  CollectionOptions,
  CollectionFilter,
  CollectionUpdate,
  CollectionFindOptions,
  CollectionWriteResult,
  CollectionBulkResult,
  CollectionBulkOp,
  CollectionChange,
  CollectionChangeStream,
} from './db/collection-model.js';
export type {
  Pipeline,
  FieldRef,
  Accumulator,
  GroupResult,
  LookedUp,
  LookupTarget,
} from './db/pipeline.js';
export { transaction } from './db/transaction.js';
export { ModelValidationError } from './db/schema.js';
export { scanDir } from './router/scan.js';
export { listTasks } from './tasks/index.js';
export { workerCount } from './cluster/index.js';
export type {
  EFCConfig,
  DatabasePoolConfig,
  CollectionSchema,
  CollectionFieldDefinition,
  GeoPoint,
  CorsConfig,
  RouteEntry,
  RouteMeta,
  RouteMethodMeta,
  RouteSchema,
  LoggingConfig,
  QueryLogConfig,
  CacheConfig,
  RequestSchema,
  Validator,
  ValidationIssue,
  TaskOptions,
  TaskDefinition,
  DatabaseEngine,
  AuthStrategy,
  ModelSchema,
  TableSchema,
  TableSchemaField,
  TableFieldDefinition,
  TableOptions,
  TableRelation,
  MigrationContext,
  SchemaField,
  Filter,
  FilterOperators,
  Update,
  FindOptions,
  IndexDefinition,
  ModelRecord,
  InferRecord,
  InferCreate,
  InferSchema,
  InferCreateInput,
  ScalarKeys,
  SortDirection,
  ModelCRUD,
  ModelQueryOptions,
  ModelOptions,
  FieldDefinition,
  DefaultOperator,
} from './types.js';

export { generateOpenAPI } from './openapi.js';
export type { OpenAPIOptions, OpenAPIDocument, JSONSchema } from './openapi.js';
export { attachWebSockets, closeWebSockets } from './websocket.js';
export type { WebSocketHandler, WebSocketOptions } from './websocket.js';
