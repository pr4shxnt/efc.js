# EFC — Exact API Surface

Source of truth: `packages/core/src/`. Do not invent exports, types, or sub-paths not listed here.

---

## Sub-path exports

Three import paths. No others exist.

```ts
import { ... } from 'express-file-cluster'          // main
import { ... } from 'express-file-cluster/auth'      // auth module
import { ... } from 'express-file-cluster/tasks'     // tasks module
```

---

## `express-file-cluster` (main)

Source: `packages/core/src/index.ts`

### Functions

```ts
// Boot the framework — returns http.Server in worker, undefined in master
async function ignite(config: EFCConfig): Promise<http.Server | undefined>

// Register SIGTERM/SIGINT handlers for clean shutdown
function gracefulShutdown(server: http.Server | undefined, timeoutMs?: number): void

// Chain middleware handlers into one RequestHandler
function compose(...handlers: RequestHandler[]): RequestHandler

// Raw database client proxy (thread-local, set during Pre-Flight)
const db: AnyClient  // Proxy — throws if accessed before Pre-Flight

// Low-level: set/get the db client (used by EFC internally)
function setDbClient(client: Record<string, unknown>): void
function getDbClient(): Record<string, unknown>

// Create an engine-agnostic model
function defineModel<T>(name: string, schema: ModelSchema): ModelCRUD<T>

// Scan a directory and return route entries (used internally by ignite)
function scanDir(dir: string, base?: string): RouteEntry[]
```

### Classes

```ts
class HttpError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string);
  name: 'HttpError';
}
```

### Types

```ts
type DatabaseEngine = 'mongodb' | 'postgresql';
type AuthStrategy = 'http-only' | 'localStorage';
type TaskBackend = 'bullmq' | 'pg-boss';

interface TaskConfig {
  backend: TaskBackend;
  redisUrl?: string;
  concurrency?: number;
}

interface CorsConfig {
  origin?: string | string[] | boolean;
  methods?: string | string[];
  allowedHeaders?: string | string[];
  credentials?: boolean;
  maxAge?: number;
}

interface EFCConfig {
  port?: number;
  apiDir: string;           // REQUIRED
  tasksDir?: string;
  database?: DatabaseEngine;
  databaseUrl?: string;
  authStrategy?: AuthStrategy;
  jwtSecret?: string;
  cluster?: boolean;
  workers?: number;
  tasks?: TaskConfig | false;
  cors?: boolean | CorsConfig;
  globalMiddlewares?: RequestHandler[];
  onWorkerReady?: (id: number) => void;
  onWorkerCrash?: (id: number, code: number) => void;
  onError?: ErrorRequestHandler;
}

interface RouteEntry {
  urlPath: string;
  filePath: string;
  params: string[];
}

interface TaskOptions {
  thread?: boolean;
  retries?: number;
  backoff?: 'fixed' | 'exponential';
  concurrency?: number;
  schedule?: string;
}

interface TaskDefinition<TPayload = unknown> {
  handler: (payload: TPayload) => Promise<void>;
  options: TaskOptions;
  name: string;
  filePath?: string;
}

interface FieldDefinition {
  type: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array';
  required?: boolean;
  unique?: boolean;
  default?: unknown;
}

type ModelSchema = Record<string, FieldDefinition>;

interface ModelCRUD<T extends Record<string, any>> {
  find(filter?: Partial<T>): Promise<(T & { id: string })[]>;
  findById(id: string): Promise<(T & { id: string }) | null>;
  findOne(filter: Partial<T>): Promise<(T & { id: string }) | null>;
  create(data: Partial<T>): Promise<T & { id: string }>;
  update(id: string, data: Partial<T>): Promise<(T & { id: string }) | null>;
  delete(id: string): Promise<void>;
  count(filter?: Partial<T>): Promise<number>;
}
```

---

## `express-file-cluster/auth`

Source: `packages/core/src/auth/index.ts`

```ts
// Set cookie (http-only strategy)
async function issueToken(res: Response, payload: Record<string, unknown>): Promise<void>

// Clear cookie (http-only strategy)
function revokeToken(res: Response): void

// Return token string (localStorage strategy)
async function signToken(payload: Record<string, unknown>): Promise<string>

// Express middleware — verifies JWT, attaches payload to req.user
const requireAuth: RequestHandler

// Internal — called by ignite()
function configureAuth(config: { secret: string; strategy: AuthStrategy; expiresIn: string; cookieDomain?: string }): void
```

Cookie name: `efc_token`. Algorithm: HS256. Library: `jose`.

---

## `express-file-cluster/tasks`

Source: `packages/core/src/tasks/index.ts`

```ts
// Create a task definition (two overloads)
function defineTask<T>(handler: (payload: T) => Promise<void>): TaskDefinition<T>
function defineTask<T>(options: TaskOptions, handler: (payload: T) => Promise<void>): TaskDefinition<T>

// Add a job to the queue
async function enqueue<T>(name: string, payload: T): Promise<void>

// Internal — used by BullMQ backend
function registerTask(name: string, def: TaskDefinition): void
function setEnqueueImpl(impl: (name: string, payload: unknown) => Promise<void>): void

// In-memory registry (Map<string, TaskDefinition>)
const taskRegistry: Map<string, TaskDefinition>
```

---

## Env vars read automatically by `ignite()`

| Var | Used for |
|---|---|
| `PORT` | Listen port (fallback to 3000) |
| `DATABASE_URL` | DB connection + engine auto-detect |
| `JWT_SECRET` | JWT signing secret |
| `JWT_EXPIRES_IN` | Token lifetime (default `7d`) |
| `COOKIE_DOMAIN` | Cookie domain for http-only auth |
| `REDIS_URL` | Not read by ignite — pass via `tasks.redisUrl` |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `NODE_ENV` | `production` → cluster default true, Secure cookie |
