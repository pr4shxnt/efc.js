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
function defineModel<T>(name: string, schema: ModelSchema, options?: ModelOptions): ModelCRUD<T>

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

type PrimitiveFieldType = 'string' | 'number' | 'boolean' | 'date' | 'object' | 'objectId';

interface FieldDefinition {
  type: PrimitiveFieldType | 'array';
  required?: boolean;
  unique?: boolean;
  default?: unknown;                    // literal value, OR a DefaultOperator sentinel string (below)
  enum?: readonly (string | number)[];  // valid on 'string'/'number' types
  ref?: string;                         // Mongoose model name; valid on 'objectId' types
  of?: PrimitiveFieldType;              // item type for 'array' fields, e.g. { type: 'array', of: 'string' }
  sequence?: boolean | string;          // auto-increment via a counters collection — see below
}

// Sentinel default-value codes resolved at schema-compile time to a generator
// function, so each document gets a freshly-computed value:
//   '$now'              → new Date()                       — pair with type: 'date'
//   '$uuid'              → crypto.randomUUID()               — pair with type: 'string'
//   '$objectId'          → new mongoose.Types.ObjectId()     — pair with type: 'objectId'
//   '$timestamp'         → Date.now() (number, epoch ms)     — pair with type: 'number'
//   '$shortId'           → random 16-char base64url string   — pair with type: 'string'
//   '$currentUser'       → getCurrentUser() (auth payload)   — pair with type: 'object'
//   '$currentUser.<key>' → getCurrentUser()?.[key]           — e.g. '$currentUser.id'
// Any other string/value passed to `default` is used as-is.
type DefaultOperator =
  | '$now' | '$uuid' | '$objectId' | '$timestamp' | '$shortId'
  | '$currentUser' | `$currentUser.${string}`;

// '$increment' is NOT a DefaultOperator — default resolution is synchronous, and an
// auto-increment counter needs an async read-modify-write against a counters
// collection. Use FieldDefinition.sequence instead:
//   { orderNumber: { type: 'number', sequence: true, required: true } }
// `sequence: true` keys the counter as '<ModelName>.<field>'; a string sets an
// explicit shared key. Assigned in a pre('validate') hook (before `required` runs),
// only on new docs, only if not already set. Top-level fields only — not inside
// nested array sub-schemas. Counter storage: internal 'efc_counters' collection,
// incremented atomically ($inc + upsert).

interface ModelOptions {
  // Passed straight through to mongoose's `timestamps` schema option.
  // Default: true (matches the framework's previous hardcoded behavior).
  timestamps?: boolean | { createdAt?: string | false; updatedAt?: string | false };
}

// A field is either a FieldDefinition, or a one-element tuple holding a nested ModelSchema —
// the latter defines an array of embedded sub-documents:
// route_progress: [{ route_id: { type: 'string' }, visited: { type: 'boolean' } }]
type ModelSchema = Record<string, FieldDefinition | [ModelSchema]>;

interface ModelQueryOptions {
  populate?: string | string[]; // Mongoose .populate() path(s) for objectId/ref fields
}

interface ModelCRUD<T extends Record<string, any>> {
  find(filter?: Partial<T>, options?: ModelQueryOptions): Promise<(T & { id: string })[]>;
  findById(id: string, options?: ModelQueryOptions): Promise<(T & { id: string }) | null>;
  findOne(filter: Partial<T>, options?: ModelQueryOptions): Promise<(T & { id: string }) | null>;
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

// Express middleware — verifies JWT, attaches payload to req.user.
// Dual-purpose: bare it's just auth; called with role names it returns a
// middleware that also enforces payload.role (403 if it doesn't match).
interface RequireAuth {
  (req: Request, res: Response, next: NextFunction): void;
  (...roles: string[]): RequestHandler;
}
const requireAuth: RequireAuth

// Internal — called by ignite()
function configureAuth(config: { secret: string; strategy: AuthStrategy; expiresIn: string; cookieDomain?: string }): void

// Reads the JWT payload requireAuth attached to the in-flight request, from
// anywhere in the async call chain (backed by AsyncLocalStorage — see context.ts).
// Returns undefined outside a request, or on a route that never ran requireAuth.
// Also what powers the '$currentUser'/'$currentUser.<key>' defineModel default codes.
function getCurrentUser(): Record<string, unknown> | undefined
```

Cookie name: `efc_token`. Algorithm: HS256. Library: `jose`.

Every request run through `ignite()` is wrapped in its own `AsyncLocalStorage` context (`packages/core/src/context.ts`) before any other middleware runs; `requireAuth` populates it with the verified JWT payload. This DOES exist now — it's no longer accurate to say EFC has no request context (see `what-not-to-invent.md`, which has been updated).

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

## `ignite()` does NOT read app config from `process.env` — `NODE_ENV` is the one exception

`ignite()` never reads `PORT`, `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `COOKIE_DOMAIN`, or `CORS_ORIGINS` itself. Each must be passed explicitly in the `EFCConfig` object — the scaffolder generates an `efc.config.ts` that reads `process.env.X` for each of these and builds that object; `src/index.ts` just spreads it into `ignite()`. See `what-not-to-invent.md` for the full "does not auto-read" list.

| Config field | Typically wired from | Fallback if unset |
|---|---|---|
| `port` | `process.env.PORT` | `3000` |
| `databaseUrl` | `process.env.DATABASE_URL` | none (no DB connects) |
| `jwtSecret` | `process.env.JWT_SECRET` | none (auth disabled) |
| `jwtExpiresIn` | `process.env.JWT_EXPIRES_IN` | `'7d'` |
| `cookieDomain` | `process.env.COOKIE_DOMAIN` | unset (host-only cookie) |
| `cors.origin` | `process.env.CORS_ORIGINS?.split(',')` | `true` (allow all) |
| `tasks.redisUrl` | `process.env.REDIS_URL` | `'redis://localhost:6379'` |

`NODE_ENV` is the sole exception — a Node/Express-wide runtime-mode signal, not an app secret — and is still read directly via `process.env['NODE_ENV']` in three places: `ignite()`'s cluster-in-production default, the dev-only dashboard toggle, and the `http-only` auth strategy's cookie `Secure` flag.
