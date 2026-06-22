# express-file-cluster &nbsp;·&nbsp; `efc`

**File-based routing. Multi-core clustering. Background tasks. Zero boilerplate.**

EFC is an opinionated backend framework built on Express. Drop files in `src/api/` and they become routes. Every CPU core serves traffic automatically. Heavy work goes to a queue-backed task subsystem so requests stay fast.

> **Status: Pre-alpha.** The router, clustering, and auth are implemented. The MongoDB adapter and task queue backend are in active development. Not yet published to npm.

---

## Why EFC

Most Express apps grow the same way: a working prototype, then a maze of `router.get(...)` calls spread across files, a clustering setup copy-pasted from a blog post, and background jobs bolted on as an afterthought. EFC collapses all of that into conventions:

| Problem | EFC's answer |
|---|---|
| Route registration ceremony | The file tree **is** the route tree |
| Single-threaded Node under load | Auto-detected CPU count → worker processes |
| Blocking work on the request path | `enqueue()` ships it to a queue; respond immediately |
| Wiring auth, DB, and middleware by hand | `ignite()` — one call bootstraps everything |

---

## Quick Start

```bash
npx create-efc-app my-api
cd my-api
npm run dev
```

The interactive scaffolder asks for language, database, auth strategy, and whether you want clustering and background tasks — then writes the boilerplate, generates a `.env` with a real `JWT_SECRET`, and runs `npm install`.

---

## Project Structure

```
my-api/
├── src/
│   ├── api/                      # Every file here is a route
│   │   ├── health.ts             # GET /health
│   │   ├── users/
│   │   │   ├── index.ts          # GET /users  •  POST /users
│   │   │   └── [id].ts           # GET /users/:id  •  DELETE /users/:id
│   │   └── posts/
│   │       └── [slug]/
│   │           └── comments.ts   # GET /posts/:slug/comments
│   ├── tasks/                    # Background jobs
│   │   ├── SendEmail.ts
│   │   └── ResizeImage.ts
│   ├── models/                   # Engine-agnostic models
│   │   └── User.ts
│   └── index.ts                  # Framework entry point
├── efc.config.ts
├── .env                          # Gitignored — JWT_SECRET auto-filled
└── .env.example
```

Routing rules:

| File | URL |
|---|---|
| `api/health.ts` | `/health` |
| `api/users/index.ts` | `/users` |
| `api/users/[id].ts` | `/users/:id` |
| `api/posts/[slug]/comments.ts` | `/posts/:slug/comments` |

---

## Route Handlers

Export uppercase HTTP method names. Anything not exported returns **405 Method Not Allowed** automatically.

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
// 1. Global — applies to every request
ignite({ globalMiddlewares: [cors(), rateLimiter()] });

// 2. Route-level — applies to every handler in this file
export const middlewares = [requireAuth];

// 3. Handler-level — applies to one handler via compose()
import { compose } from 'express-file-cluster';

export const POST = compose(
  validateBody(CreateUserSchema),
  async (req, res) => { /* req.body is validated */ },
);
```

---

## Background Tasks

Tasks run off the request path — respond immediately, let the queue handle the work.

```ts
// src/tasks/SendEmail.ts
import { defineTask } from 'express-file-cluster/tasks';

interface Payload { to: string; subject: string; body: string }

export default defineTask<Payload>(async (payload) => {
  await mailer.send(payload);
});
```

```ts
// src/tasks/ResizeImage.ts — CPU-bound: runs in a worker_threads thread
import { defineTask } from 'express-file-cluster/tasks';

export default defineTask<{ key: string; width: number }>(
  { thread: true },
  async ({ key, width }) => {
    const buf = await sharp(await download(key)).resize(width).toBuffer();
    await upload(`${key}@${width}`, buf);
  },
);
```

```ts
// Trigger from a route handler
import { enqueue } from 'express-file-cluster/tasks';

export const POST = async (req, res) => {
  const user = await User.create(req.body);
  await enqueue('SendEmail', { to: user.email, subject: 'Welcome!', body: '...' });
  res.status(202).json({ id: user.id, queued: true });
};
```

Task options:

| Option | Default | Description |
|---|---|---|
| `thread` | `false` | Run in a `worker_threads` thread (CPU-bound work) |
| `retries` | `3` | Retry attempts before dead-lettering |
| `backoff` | `'exponential'` | Delay strategy between retries |
| `concurrency` | `tasks.concurrency` | Parallel jobs for this task |
| `schedule` | — | Cron expression for recurring tasks |

---

## Authentication

### `http-only` (recommended for SSR/SSG)

Tokens stored in `HttpOnly + Secure + SameSite=Strict` cookies.

```ts
import { issueToken, revokeToken, requireAuth } from 'express-file-cluster/auth';

// src/api/auth/login.ts
export const POST = async (req, res) => {
  const user = await verifyCredentials(req.body);
  issueToken(res, { sub: user.id, role: user.role });
  res.json({ message: 'Logged in' });
};

// Protect a route
export const middlewares = [requireAuth];
```

### `localStorage` (SPA-friendly)

Token returned in body; client attaches `Authorization: Bearer <token>`.

```ts
import { signToken } from 'express-file-cluster/auth';

export const POST = async (req, res) => {
  const token = signToken({ sub: user.id });
  res.json({ token });
};
```

---

## Bootstrapper

```ts
// src/index.ts
import { ignite } from 'express-file-cluster';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

ignite({
  port: Number(process.env.PORT) || 3000,
  apiDir: path.join(__dirname, 'api'),
  tasksDir: path.join(__dirname, 'tasks'),

  database: 'mongodb',
  databaseUrl: process.env.DATABASE_URL,

  authStrategy: 'http-only',
  jwtSecret: process.env.JWT_SECRET,

  cluster: true,          // false → single process (auto-disabled in dev)
  workers: 4,             // defaults to os.cpus().length

  tasks: {
    backend: 'bullmq',
    redisUrl: process.env.REDIS_URL,
    concurrency: 5,
  },

  globalMiddlewares: [],
  onWorkerReady: (id) => console.log(`Worker ${id} ready`),
  onWorkerCrash: (id, code) => console.error(`Worker ${id} crashed (${code})`),
});
```

### `ignite()` options

| Option | Type | Default | Description |
|---|---|---|---|
| `port` | `number` | `3000` | HTTP listen port |
| `apiDir` | `string` | — | Path to route modules |
| `tasksDir` | `string` | — | Path to task modules |
| `database` | `'mongodb' \| 'postgresql'` | — | Database engine |
| `databaseUrl` | `string` | `DATABASE_URL` | Connection string |
| `authStrategy` | `'http-only' \| 'localStorage'` | — | Token delivery |
| `jwtSecret` | `string` | `JWT_SECRET` | JWT signing secret |
| `cluster` | `boolean` | `true` | Enable multi-core clustering |
| `workers` | `number` | `os.cpus().length` | Worker count override |
| `tasks` | `TaskConfig \| false` | `false` | Background task runtime |
| `globalMiddlewares` | `RequestHandler[]` | `[]` | Applied to every route |
| `onWorkerReady` | `(id) => void` | — | Called when a worker boots |
| `onWorkerCrash` | `(id, code) => void` | — | Called before respawn |
| `onError` | `ErrorRequestHandler` | built-in | Override global error handler |

---

## CLI Reference

```bash
# Development
efc start dev         # Hot-reload single process, source maps, pretty logs

# Production
efc build prod        # Type-check + compile to dist/ (tsup, dual CJS/ESM)
efc start prod        # Run dist/ with clustering enabled

# Tests
efc run tests         # Vitest  (--watch, --coverage passthrough)

# Code generation
efc generate route users/[id]       # → src/api/users/[id].ts
efc generate task ProcessPayment    # → src/tasks/ProcessPayment.ts
efc generate middleware authorize   # → src/middlewares/authorize.ts

# Diagnostics
efc routes            # Print resolved route table (path → file → methods)
efc tasks             # List registered background tasks
efc doctor            # Validate config, env vars, DB connectivity
```

---

## Clustering Architecture

```
              Master Process
         ┌────────────────────┐
         │  fork × N workers  │
         │  respawn on crash   │
         └──┬──────┬──────┬───┘
            │      │      │
       Worker 1  Worker 2  Worker N
       Pre-Flight lifecycle per worker:
         1. Connect DB
         2. Configure auth
         3. Scan apiDir → route map
         4. Register tasks
         5. Mount routes on Express
         6. Listen (OS round-robins connections)
```

CPU-bound tasks fan out further into `worker_threads` — the request loop stays unblocked at every layer.

---

## Error Handling

```ts
import { HttpError } from 'express-file-cluster';

// Throw from any handler — caught and formatted automatically
export const GET = async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, 'User not found');
  res.json(user);
};

// Override the global handler
ignite({
  onError: (err, req, res, next) => {
    logger.error(err);
    res.status(err.statusCode ?? 500).json({ error: err.message });
  },
});
```

---

## Environment Variables

`create-efc-app` generates `.env` (gitignored, `JWT_SECRET` pre-filled) and `.env.example` (committed, documented).

| Variable | Required | Description |
|---|---|---|
| `PORT` | No (default `3000`) | HTTP listen port |
| `NODE_ENV` | No | `development \| production \| test` |
| `DATABASE_URL` | Yes | MongoDB or PostgreSQL connection string |
| `JWT_SECRET` | Yes | JWT signing key — auto-generated by scaffolder |
| `JWT_EXPIRES_IN` | No (default `7d`) | Token lifetime |
| `COOKIE_DOMAIN` | No | Cookie domain for `http-only` auth |
| `REDIS_URL` | If using BullMQ | Redis connection for the task queue |

---

## Monorepo Layout

```
packages/
  core/             → express-file-cluster  (the framework)
  create-efc-app/   → interactive scaffolder
```

```bash
# Install
npm install

# Build all packages
npm run build

# Run tests
npm test

# Type-check
npm run typecheck

# Lint
npm run lint
```

---

## Roadmap

See [`todo.md`](./todo.md) for the full implementation checklist.

| Phase | Target | Focus |
|---|---|---|
| **0** | Now | Design & planning ✅ |
| **1** | Q3 2026 | Core MVP — router, clustering, auth, DB, tasks, CLI |
| **2** | Q4 2026 | Beta — PostgreSQL, Zod validation, structured logging, cron tasks |
| **3** | Q1 2027 | Stable v1.0 — plugins, WebSockets, OpenAPI, OpenTelemetry |
| **4** | 2027+ | Edge/serverless, gRPC, GraphQL |

---

## Contributing

```bash
git clone https://github.com/your-org/efc.js.git
cd efc.js
npm install
npm test
```

- **Branches:** `feat/<topic>` · `fix/<topic>` · `docs/<topic>`
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/)
- **PRs:** must include tests and a changelog entry

---

## License

MIT © 2026 EFC Contributors
