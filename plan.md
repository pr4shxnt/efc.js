# Express File Cluster (EFC) — `efc.js`

> **An enterprise-grade, opinionated, zero-boilerplate backend framework built on Express.js.**
> EFC eliminates routing ceremony via **file-based routing**, maximises throughput via **automatic multi-core CPU clustering**, and ships a first-class **background-task subsystem** for work that shouldn't block a request.

> ⚠️ **Project stage: Pre-alpha (design only).** Nothing is implemented yet — 0 lines of framework code, not published to npm, no tests. This document is the single source of truth for _what gets built and in what order_.

---

## Table of Contents

1. [Core Philosophy](#-core-philosophy)
2. [Feature Overview](#-feature-overview)
3. [CLI Reference](#-cli-reference)
4. [Installation & Scaffolding](#-installation--scaffolding)
5. [Project Structure](#-project-structure)
6. [Bootstrapper API](#-bootstrapper-api)
7. [File-Based Routing](#-file-based-routing)
8. [Route Handler Conventions](#-route-handler-conventions)
9. [Background Tasks (`/tasks`)](#-background-tasks-tasks)
10. [Middleware System](#-middleware-system)
11. [Database Context (`db`)](#-database-context-db)
12. [Authentication Strategies](#-authentication-strategies)
13. [Clustering Architecture](#-clustering-architecture)
14. [Error Handling](#-error-handling)
15. [Configuration Reference](#-configuration-reference)
16. [Roadmap](#-roadmap)
17. [Contributing](#-contributing)
18. [License](#-license)

---

## 💡 Core Philosophy

| Principle                         | Description                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Convention over Configuration** | Sensible defaults; you only configure what deviates from the norm.                                                                                     |
| **Filesystem as API Contract**    | Your directory tree _is_ your route tree — no `router.get(...)` boilerplate.                                                                           |
| **Right Tool per Workload**       | Requests are served by the cluster; heavy/async work goes to the task subsystem. The framework picks the correct execution model so you don't have to. |
| **Zero Idle Cores**               | Every available CPU thread is put to work; CPU-bound tasks can fan out to worker threads.                                                              |
| **Lifecycle Isolation**           | Each worker bootstraps its own connection pool; no shared mutable state across threads.                                                                |
| **TypeScript First**              | Full type definitions shipped in-box. JavaScript equally supported.                                                                                    |

---

## 🚀 Feature Overview

| Feature                                             | Status      |
| --------------------------------------------------- | ----------- |
| File-based routing (static, index, dynamic)         | 🏗️ Designed |
| CLI scaffolding (`create-efc-app`)                  | 🏗️ Designed |
| CLI lifecycle commands (`efc start/build/run`)      | 🏗️ Designed |
| Multi-core clustering (auto CPU detection)          | 🏗️ Designed |
| Background tasks (`/tasks`, queue + worker threads) | 🏗️ Designed |
| Per-route middleware exports                        | 🏗️ Designed |
| MongoDB adapter (`mongoose`)                        | 🏗️ Designed |
| PostgreSQL adapter (`pg` / `drizzle`)               | 🗓️ Planned  |
| Global & scoped middleware                          | 🏗️ Designed |
| http-only cookie auth                               | 🏗️ Designed |
| localStorage JWT auth                               | 🏗️ Designed |
| Catch-all / wildcard routes                         | 🗓️ Planned  |
| WebSocket support                                   | 🗓️ Planned  |
| Plugin / adapter API                                | 🗓️ Planned  |
| Edge / serverless deploy target                     | 🗓️ Planned  |

---

## 🖥️ CLI Reference

EFC ships a single `efc` binary. The scaffolder (`create-efc-app`) is separate and used once to bootstrap a project.

### Project Lifecycle

| Command          | Purpose                                                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `efc start dev`  | Start the **development server** — single process, hot-reload (`chokidar`), pretty logs, source maps. Clustering is forced off for fast restarts and clean stack traces.           |
| `efc build prod` | **Build for production** — type-check, compile TS → `dist/` (via `tsup`, dual CJS/ESM), tree-shake, and emit a frozen route manifest. Produces the artifact `efc start prod` runs. |
| `efc start prod` | Boot the **production server** from `dist/` — clustering on (`os.cpus().length` workers), task workers attached, structured logs. _(Runtime counterpart to `efc build prod`.)_     |
| `efc run tests`  | Run the **test suite** via Vitest. Pass `--watch` for TDD, `--coverage` for reports.                                                                                               |

> **Note on naming:** `efc build prod` compiles; `efc start prod` runs the compiled output. If you only run `efc build prod && efc start prod` in CI/CD, a future `efc deploy` may combine them.

### Code Generation

| Command                          | Purpose                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `efc generate route <path>`      | Scaffold a route module, e.g. `efc generate route users/[id]` → `src/api/users/[id].ts` with method stubs.          |
| `efc generate task <name>`       | Scaffold a background task, e.g. `efc generate task SendEmail` → `src/tasks/SendEmail.ts` + a typed enqueue helper. |
| `efc generate middleware <name>` | Scaffold a middleware in `src/middlewares/`.                                                                        |

### Database

| Command           | Purpose                                       |
| ----------------- | --------------------------------------------- |
| `efc db migrate`  | Run pending migrations against `databaseUrl`. |
| `efc db rollback` | Revert the last migration batch.              |
| `efc db seed`     | Run seed scripts (dev/test fixtures).         |
| `efc db studio`   | Open a local DB browser (adapter-dependent).  |

### Diagnostics & Quality

| Command                        | Purpose                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `efc lint`                     | Run ESLint + Prettier check. `--fix` to autofix.                                                  |
| `efc routes`                   | Print the resolved route table (path → file → methods) — useful for debugging file-based routing. |
| `efc tasks`                    | List registered tasks and their queue/worker config.                                              |
| `efc doctor`                   | Validate config, env vars, DB connectivity, and CPU/worker setup.                                 |
| `efc --version` / `efc --help` | Standard meta commands.                                                                           |

---

## 📦 Installation & Scaffolding

You never install EFC's dependencies by hand. The CLI reads your choices and wires everything up automatically.

```bash
npx create-efc-app my-api-project
```

### Interactive Prompts

```text
? Select Language:
  ❯ TypeScript
    JavaScript

? Select Database:
  ❯ MongoDB
    PostgreSQL

? Select Authentication Delivery Strategy:
  ❯ http-only  (Secure, server-managed cookies — recommended for SSR/SSG frontends)
    localStorage  (Client-side token management — suitable for SPAs)

? Event Loop Optimization (Multi-Core Clustering):
  ❯ enable   (Spawns N workers matching os.cpus().length)
    disable  (Runs standard single-threaded Node.js)

? Background Tasks (queue-backed /tasks subsystem):
  ❯ enable   (Sets up a job queue + task workers)
    disable  (No task runtime; /tasks is ignored)

? (if tasks enabled) Queue Backend:
  ❯ BullMQ (Redis)
    pg-boss (PostgreSQL)
```

Once confirmed, the CLI will:

1. Generate the boilerplate project tree.
2. Write a pre-configured `efc.config.ts` (or `.js`).
3. Generate **`.env`** (gitignored, with a real randomly-generated `JWT_SECRET`) **and `.env.example`** (committed, documented placeholders) — see [Environment Variables](#environment-variables).
4. Add `.env` to `.gitignore`.
5. Add lifecycle scripts to `package.json` (`dev`, `build`, `start`, `test` → the `efc` commands above).
6. `npm install` all required peer dependencies for your selections.
7. Print a **Getting Started** summary to your terminal.

### Generated `package.json` scripts

```jsonc
{
  "scripts": {
    "dev": "efc start dev",
    "build": "efc build prod",
    "start": "efc start prod",
    "test": "efc run tests",
  },
}
```

---

## 🗂️ Project Structure

```text
my-api-project/
├── src/
│   ├── api/                     # ← HTTP routes (filesystem = route tree)
│   │   ├── health.ts            # GET /health
│   │   ├── users/
│   │   │   ├── index.ts         # GET /users  •  POST /users
│   │   │   └── [id].ts          # GET /users/:id  •  PUT /users/:id  •  DELETE /users/:id
│   │   └── posts/
│   │       ├── index.ts         # GET /posts  •  POST /posts
│   │       └── [slug]/
│   │           └── comments.ts  # GET /posts/:slug/comments
│   ├── tasks/                   # ← Background jobs (queue-backed)
│   │   ├── SendEmail.ts         # task "SendEmail"  (I/O-bound)
│   │   └── ResizeImage.ts       # task "ResizeImage" (CPU-bound → worker thread)
│   ├── models/                  # ← Engine-agnostic models (defineModel)
│   │   └── User.ts              # compiles to mongoose schema OR drizzle table
│   ├── middlewares/
│   │   └── auth.ts              # Reusable middleware helpers
│   └── index.ts                 # Framework Bootstrapper
├── efc.config.ts                # Framework configuration (auto-generated)
├── .env                         # Real secrets — gitignored (JWT_SECRET auto-filled)
├── .env.example                 # Documented template — safe to commit
├── .gitignore                   # Includes .env by default
├── package.json
└── tsconfig.json
```

> **Routing rule:** Every file inside `apiDir` is a route module; its path relative to `apiDir` becomes the URL path. `[brackets]` become dynamic `req.params`.
> **Task rule:** Every file inside `tasksDir` registers a named task; the filename (sans extension) is the task name you `enqueue()`.

---

## ⚙️ Bootstrapper API

```typescript
// src/index.ts
import { ignite } from "express-file-cluster";
import path from "path";

ignite({
  port: 3000,
  apiDir: path.join(__dirname, "api"),
  tasksDir: path.join(__dirname, "tasks"),

  // --- Database ---
  database: "mongodb", // 'mongodb' | 'postgresql'
  databaseUrl: process.env.DATABASE_URL,

  // --- Auth ---
  authStrategy: "http-only", // 'http-only' | 'localStorage'
  jwtSecret: process.env.JWT_SECRET,

  // --- Clustering ---
  cluster: true, // false → single process

  // --- Background Tasks ---
  tasks: {
    backend: "bullmq", // 'bullmq' | 'pg-boss' | false
    redisUrl: process.env.REDIS_URL,
    concurrency: 5, // jobs processed in parallel per worker
  },

  // --- Global Middleware (runs before every route) ---
  globalMiddlewares: [corsMiddleware, rateLimiter],

  // --- Hooks ---
  onWorkerReady: (workerId) => console.log(`Worker ${workerId} is live.`),
  onWorkerCrash: (workerId, code) =>
    console.error(`Worker ${workerId} exited (${code}).`),
});
```

### `ignite()` Options Reference

| Option              | Type                                 | Default                    | Description                                  |
| ------------------- | ------------------------------------ | -------------------------- | -------------------------------------------- |
| `port`              | `number`                             | `3000`                     | HTTP listen port.                            |
| `apiDir`            | `string`                             | `'./api'`                  | Absolute path to route modules.              |
| `tasksDir`          | `string`                             | `'./tasks'`                | Absolute path to task modules.               |
| `database`          | `'mongodb' \| 'postgresql'`          | —                          | Database engine.                             |
| `databaseUrl`       | `string`                             | `process.env.DATABASE_URL` | Connection string.                           |
| `authStrategy`      | `'http-only' \| 'localStorage'`      | —                          | Token delivery mechanism.                    |
| `jwtSecret`         | `string`                             | `process.env.JWT_SECRET`   | JWT signing secret.                          |
| `cluster`           | `boolean`                            | `true`                     | Enable multi-core clustering.                |
| `workers`           | `number`                             | `os.cpus().length`         | Override HTTP worker count.                  |
| `tasks`             | `TaskConfig \| false`                | `false`                    | Background-task runtime config.              |
| `globalMiddlewares` | `RequestHandler[]`                   | `[]`                       | Middleware applied to every route.           |
| `onWorkerReady`     | `(id: number) => void`               | —                          | Called when a worker finishes bootstrapping. |
| `onWorkerCrash`     | `(id: number, code: number) => void` | —                          | Called before a crashed worker is replaced.  |
| `onError`           | `ErrorRequestHandler`                | built-in                   | Override the global error handler.           |

---

## 📂 File-Based Routing

### Routing Rules

| File Path                      | Resolved Route          |
| ------------------------------ | ----------------------- |
| `api/health.ts`                | `/health`               |
| `api/users/index.ts`           | `/users`                |
| `api/users/[id].ts`            | `/users/:id`            |
| `api/posts/[slug]/comments.ts` | `/posts/:slug/comments` |
| `api/auth/login.ts`            | `/auth/login`           |

### Method Dispatching

Export any combination of uppercase HTTP method names. Unimplemented methods automatically return **405 Method Not Allowed**.

```typescript
export const GET    = async (req, res) => { ... };
export const POST   = async (req, res) => { ... };
export const PUT    = async (req, res) => { ... };
export const PATCH  = async (req, res) => { ... };
export const DELETE = async (req, res) => { ... };
```

---

## 📋 Route Handler Conventions

### Static Route — `src/api/health.ts`

```typescript
import { Request, Response } from "express";

export const GET = async (req: Request, res: Response) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
};
```

### Index Route — `src/api/users/index.ts`

```typescript
import { Request, Response } from "express";
import { User } from "../../models/User"; // engine-agnostic model (see Database Context)

export const GET = async (req: Request, res: Response) => {
  const users = await User.find({}); // resolves to an array on both engines
  res.json(users);
};

export const POST = async (req: Request, res: Response) => {
  const user = await User.create(req.body); // runs validation; returns the created record
  res.status(201).json({ id: user.id });
};
```

### Dynamic Route — `src/api/users/[id].ts`

```typescript
import { Request, Response } from "express";
import { User } from "../../models/User";

export const GET = async (req: Request, res: Response) => {
  // findById casts the string param correctly for the active engine
  // (ObjectId for MongoDB, the PK type for PostgreSQL)
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
};

export const DELETE = async (req: Request, res: Response) => {
  await User.delete(req.params.id);
  res.status(204).send();
};
```

---

## ⚡ Background Tasks (`/tasks`)

The `/tasks` directory is **not** another set of HTTP routes, and it is **not** a way to pin a URL to a CPU core. (Node's `cluster` module forks identical whole-app workers and the OS round-robins _connections_ across them — you can't address an individual core by path.) Instead, `/tasks` is a **background-job subsystem**: work that should run _off_ the request/response cycle, with retries, backoff, and concurrency control.

This split exists because two very different workloads hide behind "do this task":

| Workload      | Example                                          | How EFC runs it                         | Why                                                                                                                                                                   |
| ------------- | ------------------------------------------------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I/O-bound** | Send email, call a webhook, write to S3          | Queue → async handler on the event loop | The work is mostly _waiting_ on the network. One event loop juggles thousands of concurrent waits cheaply. A dedicated core would just sit idle and add IPC overhead. |
| **CPU-bound** | Resize/transcode media, crypto, parse huge files | Queue → `worker_threads` thread         | This genuinely saturates a core. Offloading it keeps the main loop responsive. **This** is where "invoke a core" is the right instinct.                               |

> EFC does **not** hand-roll the queue. Persistence, retries, backoff, dead-lettering, and concurrency are subtle to get right, so the runtime wraps a proven backend (**BullMQ** on Redis, or **pg-boss** on Postgres). The file-based `/tasks` convention is the differentiator that sits _on top_ of it.

### Defining a task — `src/tasks/SendEmail.ts` (I/O-bound)

```typescript
import { defineTask } from "express-file-cluster/tasks";
import { mailer } from "../lib/mailer";

interface SendEmailPayload {
  to: string;
  subject: string;
  body: string;
}

// Task name is the filename: "SendEmail"
export default defineTask<SendEmailPayload>(async (payload) => {
  await mailer.send(payload); // network I/O — stays on the event loop
});
```

### Defining a CPU-bound task — `src/tasks/ResizeImage.ts`

```typescript
import { defineTask } from "express-file-cluster/tasks";
import sharp from "sharp";

interface ResizePayload {
  key: string;
  width: number;
}

// `thread: true` runs each job inside a worker_threads thread
export default defineTask<ResizePayload>(
  { thread: true },
  async ({ key, width }) => {
    const input = await downloadFromStorage(key);
    const out = await sharp(input).resize(width).toBuffer();
    await uploadToStorage(`${key}@${width}`, out);
  },
);
```

### Triggering a task from a route

Respond immediately with **202 Accepted**; the job runs later.

```typescript
// src/api/users/index.ts
import { enqueue } from "express-file-cluster/tasks";

export const POST = async (req, res) => {
  const result = await db.collection("users").insertOne(req.body);

  // fire-and-forget, off the response path
  await enqueue("SendEmail", {
    to: req.body.email,
    subject: "Welcome!",
    body: "Thanks for signing up.",
  });

  res.status(202).json({ insertedId: result.insertedId, queued: true });
};
```

### Task options (per `defineTask`)

| Option        | Type                       | Default                      | Description                                                         |
| ------------- | -------------------------- | ---------------------------- | ------------------------------------------------------------------- |
| `thread`      | `boolean`                  | `false`                      | Run each job in a `worker_threads` thread (use for CPU-bound work). |
| `retries`     | `number`                   | `3`                          | Retry attempts before dead-lettering.                               |
| `backoff`     | `'fixed' \| 'exponential'` | `'exponential'`              | Delay strategy between retries.                                     |
| `concurrency` | `number`                   | inherits `tasks.concurrency` | Parallel jobs for this task.                                        |
| `schedule`    | `string` (cron)            | —                            | Run on a recurring cron schedule.                                   |

---

## 🔗 Middleware System

EFC supports three tiers of middleware, each with a specific scope.

### 1. Global Middleware

Configured in `ignite()`. Applied to **every** request before route resolution.

```typescript
ignite({ globalMiddlewares: [corsMiddleware, rateLimiter, requestLogger] });
```

### 2. Route-Level Middleware

Export a `middlewares` array from a route module. Applied only to handlers in that file.

```typescript
// src/api/users/[id].ts
import { authenticate, authorize } from "../middlewares/auth";

export const middlewares = [authenticate, authorize("admin")];

export const DELETE = async (req, res) => {
  // Only reachable if authenticate + authorize('admin') pass
};
```

### 3. Handler-Level Middleware (Inline)

For one-off guards, wrap handlers with `compose`:

```typescript
import { compose } from "express-file-cluster";
import { validateBody } from "../middlewares/validation";

export const POST = compose(
  validateBody(CreateUserSchema),
  async (req, res) => {
    /* req.body is validated */
  },
);
```

---

## 🗄️ Database Context (`db`)

EFC offers **two levels** of database access. Both are wired to whichever engine you selected during scaffolding (`config.database`), so the same application code runs on MongoDB or PostgreSQL without modification.

### 1. Engine-Agnostic Models (recommended)

Define a model once with `defineModel`. EFC compiles your field definitions into a **mongoose schema** or a **drizzle table** depending on `config.database`, and exposes a single normalized CRUD surface. This is what your route handlers import.

```typescript
// src/models/User.ts
import { defineModel } from "express-file-cluster";

export const User = defineModel("User", {
  name: { type: "string", required: true },
  email: { type: "string", required: true, unique: true },
  role: { type: "string", default: "member" },
});
```

The returned model exposes the same async methods on both engines:

| Method                   | Returns          | Notes                                                          |
| ------------------------ | ---------------- | -------------------------------------------------------------- |
| `Model.find(filter?)`    | `Record[]`       | Resolves to an array directly.                                 |
| `Model.findById(id)`     | `Record \| null` | Casts `id` to the engine's PK type (ObjectId / serial / uuid). |
| `Model.findOne(filter)`  | `Record \| null` |                                                                |
| `Model.create(data)`     | `Record`         | Validates against the field definitions.                       |
| `Model.update(id, data)` | `Record \| null` |                                                                |
| `Model.delete(id)`       | `void`           |                                                                |
| `Model.count(filter?)`   | `number`         |                                                                |

Every record exposes a normalized `id` (mapped from Mongo's `_id` or the SQL primary key), so handler code never branches on engine.

### 2. Raw Client (`db`) — the escape hatch

For engine-specific power (aggregation pipelines, JOINs, transactions, raw SQL), import `db` — a **thread-local** native client, bootstrapped once per worker during the Pre-Flight lifecycle. No cold connections on the first request.

```typescript
import { db } from "express-file-cluster";

// When config.database === 'mongodb', db is a mongoose.Connection:
const u1 = await db.model("User").aggregate([{ $match: { role: "admin" } }]);

// When config.database === 'postgresql', db is a pg.Pool:
const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [id]);
```

> **Trade-off:** the unified model layer deliberately covers only common CRUD — it can't paper over genuinely engine-specific features (Mongo aggregation vs. SQL joins, transaction semantics, etc.). Reach for `db` when you need those, accepting that such code is tied to one engine.
>
> `db` is `undefined` until Pre-Flight resolves, but it is always ready by the time route handlers and task handlers execute.

---

## 🔐 Authentication Strategies

### `http-only` (Recommended)

Tokens stored in **HttpOnly, Secure, SameSite=Strict** cookies. Built-in helpers:

```typescript
import {
  issueToken,
  revokeToken,
  requireAuth,
} from "express-file-cluster/auth";

// src/api/auth/login.ts
export const POST = async (req, res) => {
  const user = await verifyCredentials(req.body);
  issueToken(res, { sub: user.id, role: user.role }); // sets the cookie
  res.json({ message: "Logged in" });
};

// src/api/auth/logout.ts
export const POST = async (req, res) => {
  revokeToken(res);
  res.json({ message: "Logged out" });
};
```

Protect routes with `requireAuth`:

```typescript
export const middlewares = [requireAuth];
```

### `localStorage` (SPA-friendly)

Token returned in the body; the client attaches `Authorization: Bearer <token>`.

```typescript
import { signToken } from "express-file-cluster/auth";

export const POST = async (req, res) => {
  const token = signToken({ sub: user.id });
  res.json({ token });
};
```

---

## 🏗️ Clustering Architecture

With `cluster: true`, EFC forks `N` worker processes (default `N = os.cpus().length`) using Node's `cluster` module. All workers share the port; the OS round-robins **connections** across them.

```
┌─────────────────────────────────────────────────┐
│                   Master Process                 │
│  1. os.cpus().length → determine N               │
│  2. cluster.fork() × N                           │
│  3. Listen for 'exit' → auto-respawn             │
│         ↓               ↓               ↓        │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐     │
│   │ Worker 1 │   │ Worker 2 │   │ Worker N │     │
│   │ Pre-Flight│  │ Pre-Flight│  │ Pre-Flight│    │
│   │ DB Connect│  │ DB Connect│  │ DB Connect│    │
│   │ HTTP Serve│  │ HTTP Serve│  │ HTTP Serve│    │
│   └──────────┘   └──────────┘   └──────────┘     │
└─────────────────────────────────────────────────┘
          ↑ Round-Robin Load Balancing (OS-level)

   Task workers consume the shared queue independently;
   CPU-bound tasks fan out further into worker_threads.
```

### Pre-Flight Context Lifecycle (per worker)

1. **Connect Database** — establish this worker's connection pool.
2. **Configure Auth** — wire JWT keys and cookie options.
3. **Scan API Directory** — build the route map from the filesystem.
4. **Register Tasks** — index `tasksDir` and attach queue consumers.
5. **Mount Routes** — register handlers and middleware stacks on Express.
6. **Start Listening** — announce readiness and begin accepting connections.

### Self-Healing

If a worker crashes, the master:

1. Fires `onWorkerCrash` with the worker ID and exit code.
2. Immediately forks a replacement.
3. The new worker runs the full Pre-Flight lifecycle before serving traffic.

---

## 🚨 Error Handling

### Default Behaviour

Any unhandled `throw` in a handler is caught by the global error interceptor:

```json
{ "error": "Internal Server Error", "statusCode": 500 }
```

### Custom Error Classes

```typescript
import { HttpError } from "express-file-cluster";

export const GET = async (req, res) => {
  const user = await findUser(req.params.id);
  if (!user) throw new HttpError(404, "User not found");
  res.json(user);
};
```

### Custom Global Error Handler

```typescript
ignite({
  onError: (err, req, res, next) => {
    logger.error(err);
    res.status(err.statusCode ?? 500).json({ error: err.message });
  },
});
```

---

## 🛠️ Configuration Reference

`efc.config.ts` (auto-generated, fully overridable):

```typescript
import type { EFCConfig } from "express-file-cluster";

const config: EFCConfig = {
  port: Number(process.env.PORT) || 3000,
  apiDir: "./src/api",
  tasksDir: "./src/tasks",
  database: "mongodb",
  databaseUrl: process.env.DATABASE_URL!,
  authStrategy: "http-only",
  jwtSecret: process.env.JWT_SECRET!,
  cluster: process.env.NODE_ENV === "production",
  workers: undefined, // defaults to os.cpus().length
  tasks: {
    backend: "bullmq",
    redisUrl: process.env.REDIS_URL,
    concurrency: 5,
  },
  globalMiddlewares: [],
};

export default config;
```

<a id="environment-variables"></a>

### Environment Variables

`create-efc-app` generates two files: a committed **`.env.example`** (documented placeholders) and a gitignored **`.env`** (with a cryptographically-random `JWT_SECRET` already filled in). The config above reads from these via `process.env`.

| Variable         | Required            | Description                                                                             |
| ---------------- | ------------------- | --------------------------------------------------------------------------------------- |
| `PORT`           | No (default `3000`) | HTTP listen port.                                                                       |
| `NODE_ENV`       | No                  | `development` \| `production` \| `test`. Drives clustering, log level, source maps.     |
| `DATABASE_URL`   | **Yes**             | Connection string for the chosen engine (Mongo or Postgres).                            |
| `JWT_SECRET`     | **Yes**             | JWT signing secret. Auto-generated into `.env`; regenerate with `openssl rand -hex 64`. |
| `JWT_EXPIRES_IN` | No (default `7d`)   | Token lifetime (`15m`, `1h`, `7d`, …).                                                  |
| `COOKIE_DOMAIN`  | No                  | Cookie domain for `http-only` auth; blank for localhost.                                |
| `REDIS_URL`      | If tasks use BullMQ | Redis connection for the task queue. (pg-boss reuses `DATABASE_URL`.)                   |

> **Secret hygiene:** `.env` is never committed (the CLI adds it to `.gitignore`). Use a different `JWT_SECRET` per environment, and rotate it if it's ever exposed — rotating invalidates all existing tokens.

```
[NOW]            [Q3 2026]         [Q4 2026]         [Q1 2027]         [2027+]
  │                  │                 │                  │                │
Phase 0          Phase 1           Phase 2           Phase 3           Phase 4
(Design)         (Core MVP)        (Beta)            (Stable v1.0)     (Growth)
```

### Status Legend

| Badge              | Meaning                       |
| ------------------ | ----------------------------- |
| 🏗️ **Scoping**     | Being designed / spec written |
| 🔄 **In Progress** | Actively being developed      |
| ✅ **Done**        | Merged and available          |
| 💭 **Exploring**   | Under research / discussion   |
| ❌ **Dropped**     | Deprioritised or cancelled    |

### Where We Are Now

**Pre-alpha. Design & planning only.**

- `plan.md` — architecture + API design ✅
- `ROADMAP.md` — folded into this document ✅
- Codebase — **0 lines written**
- npm package — **not published**
- Tests — **none**

---

### 🏗️ Phase 0 — Design & Planning _(Now)_

Lock the API surface, architecture, and scaffolding before writing framework code.

| #   | Task                                                           | Status     |
| --- | -------------------------------------------------------------- | ---------- |
| 1   | Define core API (`ignite()` options, route + task conventions) | 🏗️ Scoping |
| 2   | Write `plan.md` (this document)                                | ✅ Done    |
| 3   | Decide package name & npm scope                                | 🏗️ Scoping |
| 4   | Set up monorepo (core + CLI + adapters)                        | 🏗️ Scoping |
| 5   | Contribution guidelines & repo standards                       | 🏗️ Scoping |
| 6   | Choose test runner (Vitest) + CI (GitHub Actions)              | 🏗️ Scoping |

---

### Phase 1 — Core MVP _(Target: Q3 2026)_

**Goal:** A working, installable framework. `npx create-efc-app` → serve your first route.

#### 1.1 — Project Bootstrap

| #   | Task                                                                       | Status     |
| --- | -------------------------------------------------------------------------- | ---------- |
| 1   | Initialise monorepo (`packages/core`, `packages/cli`, `packages/adapters`) | 🏗️ Scoping |
| 2   | TypeScript build (`tsup`) + dual CJS/ESM output                            | 🏗️ Scoping |
| 3   | ESLint, Prettier, commit linting                                           | 🏗️ Scoping |
| 4   | GitHub Actions: lint + test on every PR                                    | 🏗️ Scoping |

#### 1.2 — File-Based Router

| #   | Task                                              | Status     |
| --- | ------------------------------------------------- | ---------- |
| 5   | Recursive `apiDir` scan → route map               | 🏗️ Scoping |
| 6   | Static / index / dynamic segment resolution       | 🏗️ Scoping |
| 7   | Method dispatching (uppercase export → HTTP verb) | 🏗️ Scoping |
| 8   | Auto `405` for unimplemented verbs                | 🏗️ Scoping |
| 9   | Per-route `middlewares[]` injection               | 🏗️ Scoping |

#### 1.3 — Clustering

| #   | Task                                                       | Status     |
| --- | ---------------------------------------------------------- | ---------- |
| 10  | Master forks `os.cpus().length` workers                    | 🏗️ Scoping |
| 11  | Pre-Flight lifecycle (DB → auth → routes → tasks → listen) | 🏗️ Scoping |
| 12  | Self-healing respawn                                       | 🏗️ Scoping |
| 13  | `onWorkerReady` / `onWorkerCrash` hooks                    | 🏗️ Scoping |
| 14  | `cluster: false` single-process bypass                     | 🏗️ Scoping |

#### 1.4 — Database Adapters

| #   | Task                                                                                                     | Status     |
| --- | -------------------------------------------------------------------------------------------------------- | ---------- |
| 15  | MongoDB adapter (`mongoose`) — thread-local pool                                                         | 🏗️ Scoping |
| 16  | `db` export resolving to the active worker's native client                                               | 🏗️ Scoping |
| 16a | `defineModel` — unified CRUD surface compiling to mongoose schema or drizzle table per `config.database` | 🏗️ Scoping |
| 16b | Normalized record shape (`id` mapped from `_id` / SQL PK)                                                | 🏗️ Scoping |

#### 1.5 — Auth + Errors

| #   | Task                                                            | Status     |
| --- | --------------------------------------------------------------- | ---------- |
| 17  | `http-only` strategy (`issueToken`/`revokeToken`/`requireAuth`) | 🏗️ Scoping |
| 18  | `localStorage` strategy (`signToken` + Bearer verify)           | 🏗️ Scoping |
| 19  | `HttpError` + global error interceptor                          | 🏗️ Scoping |

#### 1.6 — Background Tasks (MVP)

| #   | Task                                                            | Status     |
| --- | --------------------------------------------------------------- | ---------- |
| 20  | `tasksDir` scan → registered task map                           | 🏗️ Scoping |
| 21  | `defineTask` + `enqueue` API                                    | 🏗️ Scoping |
| 22  | BullMQ (Redis) backend + retries/backoff                        | 🏗️ Scoping |
| 23  | `thread: true` → `worker_threads` execution for CPU-bound tasks | 🏗️ Scoping |

#### 1.7 — CLI

| #   | Task                                                                             | Status     |
| --- | -------------------------------------------------------------------------------- | ---------- |
| 24  | `create-efc-app` interactive scaffolding                                         | 🏗️ Scoping |
| 25  | Language / DB / auth / cluster / tasks prompts                                   | 🏗️ Scoping |
| 26  | Peer-dependency auto-install per selection                                       | 🏗️ Scoping |
| 27  | Generate `.env` (random `JWT_SECRET`) + documented `.env.example` + `.gitignore` | 🏗️ Scoping |
| 27  | `efc start dev` (hot-reload single process)                                      | 🏗️ Scoping |
| 28  | `efc build prod` (type-check + compile to `dist/`)                               | 🏗️ Scoping |
| 29  | `efc start prod` (run clustered build)                                           | 🏗️ Scoping |
| 30  | `efc run tests` (Vitest)                                                         | 🏗️ Scoping |
| 31  | `efc generate route/task/middleware`                                             | 🏗️ Scoping |
| 32  | `efc routes` / `efc tasks` / `efc doctor` diagnostics                            | 🏗️ Scoping |

#### 1.8 — Testing

| #   | Task                                         | Status     |
| --- | -------------------------------------------- | ---------- |
| 33  | Unit tests: route scanner                    | 🏗️ Scoping |
| 34  | Integration: static / index / dynamic routes | 🏗️ Scoping |
| 35  | Integration: clustering respawn              | 🏗️ Scoping |
| 36  | Integration: MongoDB connection lifecycle    | 🏗️ Scoping |
| 37  | Integration: task enqueue → process → retry  | 🏗️ Scoping |

#### ✅ Phase 1 Exit Criteria

- `npx create-efc-app` works end-to-end without manual steps.
- `efc start dev` serves a route; `efc build prod` + `efc start prod` runs clustered.
- `api/users/[id].ts` resolves to `GET /users/:id`.
- `enqueue('SendEmail', …)` runs the task off the request path with retries.
- Clustering spawns the correct worker count and respawns on crash.
- `efc run tests` is green in CI.

---

### Phase 2 — Beta _(Target: Q4 2026)_

**Goal:** Fill production gaps, stabilise DX, take real-world feedback.

| #   | Feature                                        | Priority |
| --- | ---------------------------------------------- | -------- |
| 1   | PostgreSQL adapter (Drizzle ORM)               | High     |
| 2   | pg-boss task backend (Postgres-only stacks)    | High     |
| 3   | Catch-all / wildcard routes (`[...params].ts`) | High     |
| 4   | Request body validation (Zod)                  | High     |
| 5   | Structured logging (`pino`) with request IDs   | Medium   |
| 6   | Scheduled/cron tasks (`schedule` option)       | Medium   |
| 7   | Optional dynamic segments (`[[id]].ts`)        | Medium   |
| 8   | Redis adapter (cache + session store)          | Medium   |
| 9   | `efc db migrate` / `rollback` / `seed`         | Medium   |
| 10  | Dead-letter inspection in `efc tasks`          | Low      |

---

### Phase 3 — Stable v1.0 _(Target: Q1 2027)_

**Goal:** Production confidence, extensibility, full observability.

| #   | Feature                                              | Priority |
| --- | ---------------------------------------------------- | -------- |
| 1   | Plugin system (`registerPlugin()` lifecycle hooks)   | High     |
| 2   | WebSocket support (`export const WS = ...`)          | High     |
| 3   | OpenAPI auto-generation from route exports           | High     |
| 4   | OpenTelemetry distributed tracing (HTTP + tasks)     | High     |
| 5   | `efc/testing` (`createTestApp()`)                    | High     |
| 6   | `efc studio` — live route map, worker + queue status | Medium   |
| 7   | Third-party security audit (auth, cookies, queue)    | High     |
| 8   | Benchmarks vs. bare Express / Fastify                | Medium   |
| 9   | Semver + LTS policy (24-month patch support)         | High     |
| 10  | Docs site with versioning, search, API reference     | High     |

---

### Phase 4 — Growth _(2027+)_

Explored with the community. Not committed.

| Idea                      | Notes                                                               |
| ------------------------- | ------------------------------------------------------------------- |
| Edge / Serverless targets | Vercel, Cloudflare Workers — strips `cluster`, adapts runtime/tasks |
| gRPC transport            | `export const GRPC = ...`; shares DB + task context                 |
| GraphQL adapter           | Schema-first: `export const GRAPHQL = schema`                       |
| SSE helper                | `res.sse()` sugar for event streams                                 |
| Multi-language sidecars   | Python/Rust task workers managed by the EFC master                  |

---

### Bug Fix Policy _(once code exists)_

| Severity          | SLA                 | Example                                                           |
| ----------------- | ------------------- | ----------------------------------------------------------------- |
| **P0 — Critical** | Patch within 48h    | Data loss, auth bypass, crash on startup                          |
| **P1 — High**     | Patch within 1 week | Route not resolving, worker not respawning, task silently dropped |
| **P2 — Medium**   | Next minor release  | Wrong TS types, misleading error message                          |
| **P3 — Low**      | Best effort         | Cosmetic CLI issues, doc typos                                    |

---

## 🤝 Contributing

```bash
# 1. Fork and clone
git clone https://github.com/your-org/efc.js.git
cd efc.js

# 2. Install dependencies
npm install

# 3. Run tests
efc run tests        # or: npm test

# 4. Develop against the example project
cd example && efc start dev
```

- **Branch naming:** `feat/<topic>`, `fix/<topic>`, `docs/<topic>`
- **Commits:** follow [Conventional Commits](https://www.conventionalcommits.org/)
- **PRs:** must include tests and a CHANGELOG entry

### How to Influence the Roadmap

1. **Open a GitHub Discussion** — propose a feature or share a use-case.
2. **Upvote issues** — 👍 reactions influence prioritisation.
3. **Submit a PR** — fastest path from idea to ship.

> Dates are targets, not guarantees. Living document — last updated June 2026.

---

## 📜 License

MIT © 2026 — EFC Contributors
