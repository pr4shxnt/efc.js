# EFC — Pre-Flight Lifecycle (Exact)

Source: `packages/core/src/index.ts` — `ignite()` function, worker branch.

This is the exact order of operations inside every worker process (or the single process when `cluster: false`).

---

## Step-by-step sequence

```
ignite() called
     │
     ├─ cluster.isPrimary && cluster enabled?
     │       YES → runMaster() → fork workers → return undefined (master exits here)
     │       NO  → continue as worker
     │
     ▼
0. configureLogger(config.logging)   (runs before the primary/worker split)

1. Create Express app
   - Wrap every request in an AsyncLocalStorage context
   - requestLogger(): X-Request-Id → req.id / req.log / getLogger(); one log line per response
   - requestTimeout → 408 middleware (if set)
   - Apply CORS middleware (from config.cors — ignite() never reads CORS_ORIGINS itself)
   - Apply express.json()
   - Apply express.urlencoded({ extended: true })
   - Apply cookieParser()
   - Apply globalMiddlewares[] (from config)

2. Connect Database  [database = config.database ?? scheme of databaseUrl]
   - setDbEngine(database)  → decides what defineModel compiles to (mongoose / Drizzle)
   - mongodb:    connectMongo(url) → setDbClient(mongoose.connection)
   - postgresql: connectPostgres(url) → pg Pool (+ Drizzle) → setDbClient(pool)
   - db proxy is now live. Models compile lazily on first use.

3. Configure Auth  [if jwtSecret is set]
   - configureAuth({ secret, strategy, expiresIn, cookieDomain? })
   - issueToken / requireAuth / signToken are now usable

4. Scan + Register Tasks  [src/tasks by convention — there is no tasksDir option]
   - scanTasks(tasksDir)
   - Walks tasksDir, imports each file, reads default export
   - Calls registerTask(basename, definition) for each valid TaskDefinition

5. Start Task Queue Backend  [if config.tasks is set]
   - backend === 'bullmq' → initBullMQ({ redisUrl, concurrency, enqueueTimeout, queue })
     - Queue(queue) with enableOfflineQueue: false; Worker(queue, processor)
     - cron schedulers reconciled in the BACKGROUND (Redis outage can't block boot)
   - backend === 'pg-boss' → initPgBoss({ connectionString ?? databaseUrl, ... })
     - one pg-boss queue per task: `<queue>.<Task>`; work() + schedule() per task
   - setEnqueueImpl(...) → enqueue() is now usable

6. Scan Routes
   - scanDir(apiDir) → RouteEntry[]
   - File → URL transformation (see routing-rules.md)
   - Per-segment specificity sort

7. Mount Routes
   - mountRoutes(app, routes)
   - Dynamic import of each route module
   - Register handlers on Express

8. Register error handler  [onError if provided, else built-in]

9. app.listen(port)
   - Resolves Promise<http.Server> on 'listening' event
   - Logs: Worker <id> listening on :<port>
```

---

## Key invariants

- **Steps 2–5 run BEFORE routes are mounted.** By the time a handler executes, `db` is live and `enqueue()` works.
- **Each worker runs all 8 steps independently.** Workers never share DB connections or task registry state.
- **`cluster: false` is identical** — the same 8 steps run in the single process, skipping the fork branch.
- **`cluster: true` + `cluster.isPrimary`** — the master process does NOTHING after `runMaster()`. It forks workers and watches `exit` events. It does not run Pre-Flight.

---

## `runMaster()` (cluster/index.ts)

```ts
runMaster({ workers, onWorkerReady, onWorkerCrash })
  → cluster.fork() × workers
  → cluster.on('online', worker => onWorkerReady?.(worker.id))
  → cluster.on('exit', (worker, code, signal) => {
      if (!isShuttingDown) {
        onWorkerCrash?.(worker.id, code ?? -1)
        cluster.fork()   // immediate respawn, no delay
      }
    })
```

The master never calls `app.listen()`. If `ignite()` is called in the primary process, it returns `undefined` — not a server.

---

## `gracefulShutdown()` — shutdown path

```
SIGTERM or SIGINT received
     │
     ├─ already shutting down? → ignore (repeat signals must not kill a draining worker)
     │
     ├─ server is defined (worker or single-process)
     │    → server.closeIdleConnections()
     │    → server.close(() => closeBullMQ() + closePgBoss() → process.exit(0))
     │    → setTimeout(force process.exit(1), timeoutMs)  // default 10s
     │
     └─ server is undefined (primary)
          → shutdownMaster(): isShuttingDown = true, SIGTERM relayed to every worker
            (docker stop / k8s only signal PID 1)
          → primary exits when all workers have; force-exit after timeoutMs + 2s
```

---

## Port resolution (exact precedence)

```
1. config.port  (if provided and not NaN)
2. 3000  (hardcoded default)
```

`ignite()` never reads `process.env.PORT` itself — pass it explicitly (typically via `efc.config.ts`: `port: process.env.PORT ? Number(process.env.PORT) : undefined`).

---

## Cluster enable/disable logic (exact)

```ts
const clusterEnabled = config.cluster ?? (process.env['NODE_ENV'] === 'production');
```

- `config.cluster` is `undefined` AND `NODE_ENV !== 'production'` → **clustering OFF** (dev default)
- `config.cluster` is `undefined` AND `NODE_ENV === 'production'` → **clustering ON**
- `config.cluster: true` → **ON** regardless of NODE_ENV
- `config.cluster: false` → **OFF** regardless of NODE_ENV

`efc start dev` sets `NODE_ENV=development` → clustering is automatically off in dev.

## PostgreSQL prepared statements (M6)

`databasePool.preparedStatements?: boolean | { max?: number }` defaults true/100 names per physical connection; false or max 0 disables (Mongo ignores). A private Pool/client proxy is passed to Drizzle, preserving Pool identity and transaction-client release; exported native `db` is unchanged. Object query configs for single SELECT/INSERT/UPDATE/DELETE/WITH statements get a SQL-shape hash name; parameters/types/rowMode are untouched, explicit names/control/DDL/multi-statements unchanged. Lifetime budget bounds server names, with unnamed fallback (no eviction/DEALLOCATE). Schema sync/drop bumps generation; connection budgets never reset. External DDL requires reconnecting, and incompatible poolers require opting out. `prepared-statements.integration.test.ts` proves reuse, transactions, budget/disable and schema invalidation.

`logging.queries.metrics: true | { maxEntries }` enables bounded per-process model/op aggregates (default off; enabled default 1000, zero disables). Main exports `getQueryMetrics`, `resetQueryMetrics`, `QueryMetric`, `QueryMetricsSnapshot`. Snapshots contain counters/latency summaries, since and dropped observations; no SQL/params/error details. Nested statement counts inclusive; reset/reconfigure starts a new window. Not distributed tracing.

Since 0.11.0: after route mounting metadata is loaded, optional OpenAPI is generated/served before attaching the API router. The HTTP server is explicitly created, WS upgrades attach when a WS export exists, then it listens. Graceful shutdown drains WS sockets before completing backend shutdown. Origin policy is separate from CORS; middleware/auth runs during upgrade.

Unreleased tracing: SDK initialization belongs to the app, before ignite, per serving process. HTTP instrumentation precedes request logging; native queue hooks receive `tracing.tasks` at backend init. After HTTP/WS/task drain, gracefulShutdown awaits the app `tracing.shutdown` once under the existing deadline; callback rejection exits 1. Cluster-primary SDK lifecycle for custom primary spans is app-owned.

Hardening: shutdown waits for every transport/task close result, then closes cache, then app telemetry; all cleanup is attempted and any failure exits 1. Invalid memory capacity fails before replacing a live store.
