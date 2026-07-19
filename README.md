<div align="center">

<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 32 32" fill="none" aria-label="EFC logo">
  <rect x="6" y="7" width="20" height="3" rx="1.5" fill="currentColor"/>
  <rect x="6" y="14.5" width="14" height="3" rx="1.5" fill="currentColor" opacity="0.85"/>
  <rect x="6" y="22" width="20" height="3" rx="1.5" fill="currentColor"/>
</svg>

# express-file-cluster

**File-based routing · Multi-core clustering · Background tasks · Zero boilerplate**

[![npm version](https://img.shields.io/npm/v/express-file-cluster?color=6366f1&label=npm&logo=npm&logoColor=white)](https://www.npmjs.com/package/express-file-cluster)
[![npm downloads](https://img.shields.io/npm/dm/express-file-cluster?color=8b5cf6&logo=npm&logoColor=white)](https://www.npmjs.com/package/express-file-cluster)
[![CI](https://img.shields.io/github/actions/workflow/status/pr4shxnt/efc.js/ci.yml?branch=main&label=CI&logo=github&logoColor=white)](https://github.com/pr4shxnt/efc.js/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-22c55e?logo=opensourceinitiative&logoColor=white)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-6366f1?logo=github&logoColor=white)](https://github.com/pr4shxnt/efc.js/pulls)

</div>

---

EFC is an opinionated backend framework built on Express. Drop files in `src/api/` and they become routes. Every CPU core serves traffic automatically. Heavy work goes to a queue-backed task system so your request handlers stay fast.

```bash
npx create-efc-app my-api
cd my-api
efc start dev
```

---

## Table of Contents

- [Why EFC](#why-efc)
- [Installation](#installation)
- [Project Structure](#project-structure)
- [File-Based Routing](#file-based-routing)
- [Middleware](#middleware)
- [Database](#database)
- [Authentication](#authentication)
- [Background Tasks](#background-tasks)
- [Clustering](#clustering)
- [Error Handling](#error-handling)
- [CLI Reference](#cli-reference)
- [Configuration Reference](#configuration-reference)
- [Environment Variables](#environment-variables)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Why EFC

Most Express apps grow the same way: a working prototype, then a maze of `router.get(...)` calls spread across files, a clustering setup copy-pasted from a blog post, and background jobs bolted on as an afterthought.

EFC collapses all of that into conventions:

| Pain point | EFC's answer |
|---|---|
| Route registration ceremony | The file tree **is** the route tree |
| Single-threaded Node under load | Auto-detected CPU count → worker processes |
| Blocking work on the request path | `enqueue()` ships it off; respond immediately |
| Wiring auth, DB, and middleware by hand | `ignite()` — one call bootstraps everything |
| Scattered model definitions | `defineModel()` — typed CRUD with zero ORM ceremony |
| Per-request user context in nested calls | `AsyncLocalStorage`-backed `getCurrentUser()` |

---

## Installation

**Scaffold a new project (recommended):**

```bash
npx create-efc-app my-api
```

The interactive scaffolder asks for language, database, auth strategy, clustering, and task queue — then generates everything including a `.env` with a real `JWT_SECRET`.

**Add to an existing Express project:**

```bash
npm install express-file-cluster
```

> **Requires:** Node.js ≥ 20 · TypeScript 5.x (optional but recommended)

---

## Project Structure

```
my-api/
├── src/
│   ├── api/                          # Every file here becomes a route
│   │   ├── health.ts                 # → GET /v1/api/health
│   │   ├── users/
│   │   │   ├── index.ts              # → GET /v1/api/users  POST /v1/api/users
│   │   │   └── [id].ts              # → GET /v1/api/users/:id  DELETE …
│   │   └── posts/
│   │       └── [slug]/
│   │           └── comments.ts       # → GET /v1/api/posts/:slug/comments
│   ├── tasks/                        # Background job definitions
│   │   ├── SendEmail.ts
│   │   └── ResizeImage.ts
│   ├── models/
│   │   └── User.ts                   # defineModel() schemas
│   └── index.ts                      # ignite() entry point
├── efc.config.ts
├── .env                              # Gitignored — JWT_SECRET auto-generated
└── .env.example
```

---

## File-Based Routing

Export uppercase HTTP method names from any file under `src/api/`. Everything else returns **405 Method Not Allowed** automatically.

### Routing rules

| File | Route |
|---|---|
| `api/health.ts` | `GET /health` |
| `api/users/index.ts` | `GET /users` · `POST /users` |
| `api/users/[id].ts` | `GET /users/:id` · `DELETE /users/:id` |
| `api/posts/[slug]/comments.ts` | `GET /posts/:slug/comments` |

### Route handler

```ts
// src/api/users/index.ts
import type { Request, Response } from 'express';
import { User } from '../../models/User';

export const GET = async (req: Request, res: Response) => {
  const users = await User.find();
  res.json(users);
};

export const POST = async (req: Request, res: Response) => {
  const user = await User.create(req.body);
  res.status(201).json({ id: user.id });
};
```

```ts
// src/api/users/[id].ts
import type { Request, Response } from 'express';
import { User } from '../../models/User';
import { HttpError } from 'express-file-cluster';

export const GET = async (req: Request, res: Response) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, 'User not found');
  res.json(user);
};

export const DELETE = async (req: Request, res: Response) => {
  await User.delete(req.params.id);
  res.status(204).send();
};
```

---

## Middleware

Three tiers, each with a clear scope:

```ts
// 1. Global — runs on every request (configured in ignite())
ignite({ globalMiddlewares: [rateLimiter()] });

// 2. Route-level — applies to all handlers in this file
export const middlewares = [requireAuth];

// 3. Handler-level — compose() wraps a single handler
import { compose } from 'express-file-cluster';

export const POST = compose(
  validateBody(CreateUserSchema),
  async (req, res) => {
    // req.body is validated here
  },
);
```

---

## Database

### `defineModel()`

Declare a typed model with a schema. EFC compiles it to a Mongoose model and wraps it in a clean CRUD surface.

```ts
// src/model/User.ts
import { defineModel } from 'express-file-cluster';

interface UserDocument {
  name: string;
  email: string;
  role: 'admin' | 'user';
  verifyToken: string;
  createdAt?: Date;
}

export const User = defineModel<UserDocument>('User', {
  name:        { type: 'string', required: true },
  email:       { type: 'string', required: true, unique: true },
  role:        { type: 'string', enum: ['admin', 'user'], default: 'user' },
  verifyToken: { type: 'string', default: '$uuid' },   // fresh UUID per document
});
```

### Schema default operator codes

Instead of a literal or a raw function, pass a sentinel string — EFC resolves it to a fresh per-document value at schema-compile time:

| Code | Resolves to |
|---|---|
| `'$now'` | `new Date()` |
| `'$uuid'` | `crypto.randomUUID()` |
| `'$objectId'` | fresh Mongoose `ObjectId` |
| `'$timestamp'` | `Date.now()` (number) |
| `'$shortId'` | random 16-char base64url string |
| `'$currentUser'` | full JWT payload from the in-flight request |
| `'$currentUser.<key>'` | single field from that payload (e.g. `'$currentUser.id'`) |

### Auto-increment (`sequence`)

```ts
export const Order = defineModel<OrderDocument>('Order', {
  orderNumber: { type: 'number', sequence: true, required: true },
  // sequence: 'global.orders' — explicit key to share a counter across models
});
```

`sequence` is assigned atomically in a `pre('validate')` hook — it fires before `required` validation, so the field can be both `required: true` and auto-filled.

### Timestamps control

```ts
// Disable Mongoose's automatic createdAt/updatedAt
export const Role = defineModel<RoleDocument>('Role', schema, {
  timestamps: false,
});

// Or rename them
export const Audit = defineModel<AuditDocument>('Audit', schema, {
  timestamps: { createdAt: 'created_at', updatedAt: false },
});
```

### CRUD surface

```ts
await User.find({ role: 'admin' });            // find all matching
await User.findById('66a1...');                // by _id
await User.findOne({ email: 'a@b.com' });      // first match
await User.create({ name: 'Alice', ... });     // insert
await User.update('66a1...', { name: 'Bob' }); // findOneAndUpdate
await User.delete('66a1...');                  // remove
await User.count({ role: 'user' });            // count matching
```

Populate references:

```ts
await Post.find({}, { populate: 'author' });
await Post.findById(id, { populate: ['author', 'comments.user'] });
```

---

## Authentication

### `http-only` strategy _(recommended for SSR)_

Tokens are stored in `HttpOnly; Secure; SameSite=Strict` cookies — no JS access, no XSS risk.

```ts
import { issueToken, revokeToken, requireAuth } from 'express-file-cluster/auth';

// Login
export const POST = async (req, res) => {
  const user = await verifyCredentials(req.body);
  issueToken(res, { sub: user.id, role: user.role });
  res.json({ ok: true });
};

// Logout
export const DELETE = async (req, res) => {
  revokeToken(res);
  res.json({ ok: true });
};
```

### `localStorage` strategy _(SPA-friendly)_

Token returned in the response body; client attaches `Authorization: Bearer <token>`.

```ts
import { signToken } from 'express-file-cluster/auth';

export const POST = async (req, res) => {
  const token = signToken({ sub: user.id });
  res.json({ token });
};
```

### Protecting routes

```ts
// Route-level (all handlers in this file)
export const middlewares = [requireAuth];

// Role-gated
export const middlewares = [requireAuth('admin')];

// Handler-level
export const DELETE = compose(requireAuth('admin'), async (req, res) => { ... });
```

### Request context

```ts
import { getCurrentUser } from 'express-file-cluster/auth';

// Available anywhere inside a request (including inside defineModel defaults)
const user = getCurrentUser(); // Record<string, unknown> | undefined
```

---

## Background Tasks

Tasks run off the request path — enqueue and respond immediately; the queue handles the rest.

### Define a task

```ts
// src/tasks/SendEmail.ts
import { defineTask } from 'express-file-cluster/tasks';

interface Payload { to: string; subject: string; body: string }

export default defineTask<Payload>(async (payload) => {
  await mailer.send(payload);
});
```

```ts
// src/tasks/ResizeImage.ts — CPU-bound: runs in worker_threads
import { defineTask } from 'express-file-cluster/tasks';

export default defineTask<{ key: string; width: number }>(
  { thread: true, retries: 2, backoff: 'exponential' },
  async ({ key, width }) => {
    const buf = await sharp(await download(key)).resize(width).toBuffer();
    await upload(`${key}@${width}`, buf);
  },
);
```

### Enqueue from a route

```ts
import { enqueue } from 'express-file-cluster/tasks';

export const POST = async (req, res) => {
  const user = await User.create(req.body);
  await enqueue('SendEmail', { to: user.email, subject: 'Welcome!', body: '...' });
  res.status(202).json({ id: user.id, queued: true });
};
```

### Task options

| Option | Type | Default | Description |
|---|---|---|---|
| `thread` | `boolean` | `false` | Run in a `worker_threads` thread (CPU-bound work) |
| `retries` | `number` | `3` | Attempts before dead-lettering |
| `backoff` | `'fixed' \| 'exponential'` | `'exponential'` | Retry delay strategy |
| `concurrency` | `number` | `tasks.concurrency` | Parallel workers for this task |

---

## Clustering

EFC uses Node's built-in `cluster` module. The master process forks one worker per CPU core; each worker runs the full Pre-Flight lifecycle independently.

```
           Master Process
      ┌────────────────────┐
      │  fork × N workers  │
      │  respawn on crash  │
      └──┬──────┬──────┬───┘
         │      │      │
    Worker 1  Worker 2  Worker N
    ─────────────────────────────
    Pre-Flight (per worker):
      1. Connect database
      2. Configure auth
      3. Scan tasksDir → register tasks
      4. Start BullMQ backend
      5. Scan apiDir → build route map
      6. Mount routes on Express
      7. server.listen()   ← OS load-balances connections
```

CPU-bound tasks fan out further into `worker_threads` — the request loop stays unblocked at every layer.

```ts
ignite({
  cluster: true,         // false → single process (auto in dev)
  workers: 4,            // default: os.cpus().length
  onWorkerReady: (id) => console.log(`Worker ${id} ready`),
  onWorkerCrash: (id, code) => console.error(`Worker ${id} crashed (${code})`),
});
```

---

## Error Handling

Throw `HttpError` from any handler — it's caught and formatted automatically.

```ts
import { HttpError, isHttpError } from 'express-file-cluster';

export const GET = async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, 'User not found');
  res.json(user);
};

// Factory method for wrapping unknown errors
const err = HttpError.from(someError, 500);
```

Override the global error handler:

```ts
ignite({
  onError: (err, req, res, next) => {
    logger.error(err);
    res.status(err.statusCode ?? 500).json({ error: err.message });
  },
});
```

---

## CLI Reference

```bash
# Development
efc start dev                        # Hot-reload single process (tsx --watch)

# Production
efc build prod                       # Type-check + compile (tsup, dual CJS/ESM)
efc start prod                       # Run dist/ with clustering enabled

# Testing
efc run tests                        # Vitest (--watch, --coverage passthrough)

# Code generation
efc generate route users/[id]        # → src/api/users/[id].ts
efc generate task ProcessPayment     # → src/tasks/ProcessPayment.ts
efc generate middleware authorize    # → src/middlewares/authorize.ts

# Diagnostics
efc routes                           # Print resolved route table (path → file → methods)
efc tasks                            # List registered background tasks
efc doctor                           # Validate config, env vars, DB connectivity
```

---

## Configuration Reference

EFC uses a two-file convention: all runtime values are read from `process.env` in `efc.config.ts` and passed explicitly to `ignite()`. The framework never reads `process.env` itself (except `NODE_ENV`).

```ts
// efc.config.ts  ← single source of truth for all runtime values
import type { EFCConfig } from 'express-file-cluster';

const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : undefined;

const config: EFCConfig = {
  port: process.env.PORT ? Number(process.env.PORT) : undefined,
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN,
  cookieDomain: process.env.COOKIE_DOMAIN,
  cors: corsOrigins ? { origin: corsOrigins } : true,
  authStrategy: 'http-only',   // 'http-only' | 'localStorage'
  tasks: { backend: 'bullmq', concurrency: 5, redisUrl: process.env.REDIS_URL },
  globalMiddlewares: [],
};

export default config;
```

```ts
// src/index.ts  ← entry point: spread config, choose cluster mode
import { ignite, gracefulShutdown } from 'express-file-cluster';
import config from '../efc.config.js';

ignite({
  ...config,
  cluster: true,   // false in dev (efc start dev forces single-process)
}).then(gracefulShutdown).catch(console.error);
```

`apiDir` and `tasksDir` are **auto-resolved** — EFC probes `src/api`, `src/tasks`, `dist/api`, `dist/tasks` in order. You only need to pass them if your layout differs from the convention.

### `EFCConfig` options

| Option | Type | Default | Description |
|---|---|---|---|
| `port` | `number` | `3000` | HTTP listen port |
| `basePath` | `string` | `'/v1/api'` | URL prefix for all routes |
| `database` | `'mongodb' \| 'postgresql'` | auto-detected | Database engine |
| `databaseUrl` | `string` | — | Connection string (MongoDB auto-detected from `mongodb://` prefix) |
| `authStrategy` | `'http-only' \| 'localStorage'` | `'http-only'` | Token delivery method |
| `jwtSecret` | `string` | — | JWT signing secret |
| `jwtExpiresIn` | `string` | `'7d'` | Token lifetime |
| `cookieDomain` | `string` | — | Cookie domain (`http-only` only) |
| `cluster` | `boolean` | `true` in prod | Enable multi-core clustering |
| `workers` | `number` | `os.cpus().length` | Worker count override |
| `tasks` | `TaskConfig \| false` | `false` | Background task runtime |
| `cors` | `boolean \| CorsConfig` | `true` | CORS configuration |
| `requestTimeout` | `number` | — | Request timeout in ms (408 on exceed) |
| `globalMiddlewares` | `RequestHandler[]` | `[]` | Applied to every route |
| `dashboard` | `boolean` | `true` in dev | Dev route dashboard at `/` |
| `onWorkerReady` | `(id) => void` | — | Called when a worker boots |
| `onWorkerCrash` | `(id, code) => void` | — | Called before respawn |
| `onError` | `ErrorRequestHandler` | built-in | Override global error handler |

---

## Environment Variables

`create-efc-app` generates `.env` (gitignored, `JWT_SECRET` pre-filled) and `.env.example` (committed, documented). EFC **does not** auto-load any of these — read them yourself in `efc.config.ts` and pass them to `ignite()`.

| Variable | Required | Description |
|---|---|---|
| `PORT` | No (default `3000`) | HTTP listen port |
| `NODE_ENV` | No | `development \| production \| test` — **only** env var EFC reads directly |
| `DATABASE_URL` | If using a database | MongoDB or PostgreSQL connection string |
| `JWT_SECRET` | If using auth | JWT signing key — auto-generated by scaffolder |
| `JWT_EXPIRES_IN` | No (default `7d`) | Token lifetime |
| `COOKIE_DOMAIN` | No | Cookie domain for `http-only` auth |
| `REDIS_URL` | If using BullMQ | Redis connection for the task queue |
| `CORS_ORIGINS` | No | Comma-separated allowed origins |

---

## Monorepo Layout

```
packages/
  core/               → express-file-cluster        (the framework)
  create-efc-app/     → npx create-efc-app           (interactive scaffolder)
docs/                 → documentation source
client/               → marketing site
```

### Contributing locally

```bash
git clone https://github.com/pr4shxnt/efc.js.git
cd efc.js
npm install          # installs all workspace packages

npm run build        # build all packages
npm test             # run tests (Vitest)
npm run typecheck    # tsc across all packages
npm run lint         # ESLint
```

---

## Roadmap

| Phase | Status | Focus |
|---|---|---|
| **1** | 🟡 In progress | Router, clustering, MongoDB, BullMQ, auth, CLI, scaffolder |
| **2** | ⬜ Planned | PostgreSQL (Drizzle), Zod validation, structured logging (`pino`), cron tasks |
| **3** | ⬜ Planned | Plugins, WebSockets, OpenAPI auto-gen, OpenTelemetry, `efc studio` |
| **4** | ⬜ Planned | Edge/serverless adapter, gRPC, GraphQL |

See [`todo.md`](./todo.md) for the full implementation checklist.

> **Note:** EFC is architecturally incompatible with Vercel's serverless runtime — it relies on Node.js `cluster`, `server.listen()`, and persistent Redis connections. A serverless adapter is planned for Phase 4.

---

## Contributing

Contributions, issues, and pull requests are welcome!

- **Branches:** `feat/<topic>` · `fix/<topic>` · `docs/<topic>`
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/)
- **PRs:** should include tests, pass CI, and reference an issue where applicable

```bash
git clone https://github.com/pr4shxnt/efc.js.git
cd efc.js && npm install
npm test && npm run lint
```

---

## License

[MIT](./LICENSE) © 2026 [pr4shxnt](https://github.com/pr4shxnt)
