/**
 * EFC documentation content split by topic.
 * Each entry becomes an MCP resource the client can fetch.
 */

export interface DocEntry {
  name: string;
  description: string;
  content: string;
}

export const docs: Record<string, DocEntry> = {
  // ── Overview ──────────────────────────────────────────────────────────────
  'efc://docs/overview': {
    name: 'overview',
    description: 'High-level introduction to EFC — what it is and why it exists.',
    content: `# express-file-cluster (EFC) — Overview

EFC is an opinionated backend framework built on Express.
File-based routing · Multi-core clustering · Background tasks · Zero boilerplate.

Status: v0.2.x (Beta). The router, clustering, and auth are implemented.
The MongoDB adapter and task queue backend are in active development.

## Why EFC?

| Problem                             | EFC's answer                                        |
|-------------------------------------|-----------------------------------------------------|
| Route registration ceremony         | The file tree IS the route tree                     |
| Single-threaded Node under load     | Auto-detected CPU count → worker processes          |
| Blocking work on the request path   | enqueue() ships it to a queue; respond immediately  |
| Wiring auth, DB, and middleware     | ignite() — one call bootstraps everything           |

## Quick Start

  npx create-efc-app my-api
  cd my-api
  efc start dev

The interactive scaffolder asks for language, database, auth strategy,
clustering, and background tasks — generates .env with JWT_SECRET, then
runs npm install.`,
  },

  // ── Routing ───────────────────────────────────────────────────────────────
  'efc://docs/routing': {
    name: 'routing',
    description: 'File-based routing rules, dynamic segments, and HTTP method exports.',
    content: `# EFC Routing

## Project Structure

  src/api/
  ├── health.ts              → GET /health
  ├── users/
  │   ├── index.ts           → GET /users  ·  POST /users
  │   └── [id].ts            → GET /users/:id  ·  DELETE /users/:id
  └── posts/
      └── [slug]/
          └── comments.ts    → GET /posts/:slug/comments

## Rules

| File pattern          | URL pattern           |
|-----------------------|-----------------------|
| api/health.ts         | /health               |
| api/users/index.ts    | /users                |
| api/users/[id].ts     | /users/:id            |
| api/posts/[slug]/x.ts | /posts/:slug/x        |

## Route Handler File

Export uppercase HTTP method names. Unexported methods auto-return 405.

  // src/api/users/index.ts
  import type { Request, Response } from 'express';

  export const GET = async (req: Request, res: Response) => {
    const users = await User.find();
    res.json(users);
  };

  export const POST = async (req: Request, res: Response) => {
    const user = await User.create(req.body);
    res.status(201).json({ id: user.id });
  };

## Dynamic Route Handler

  // src/api/users/[id].ts
  import { HttpError } from 'express-file-cluster';

  export const GET = async (req: Request, res: Response) => {
    const user = await User.findById(req.params.id);
    if (!user) throw new HttpError(404, 'User not found');
    res.json(user);
  };

  export const DELETE = async (req: Request, res: Response) => {
    await User.delete(req.params.id);
    res.status(204).send();
  };`,
  },

  // ── Middleware ────────────────────────────────────────────────────────────
  'efc://docs/middleware': {
    name: 'middleware',
    description: 'Three-tier middleware system: global, route-level, and handler-level via compose().',
    content: `# EFC Middleware

Three tiers with clear scope:

## 1. Global — every request

  ignite({
    globalMiddlewares: [rateLimiter()],
  });

  CORS is built-in. Configure origins via CORS_ORIGINS env var.

## 2. Route-level — every handler in a file

  // src/api/admin/users.ts
  export const middlewares = [requireAuth, requireAdmin];

  export const GET = async (req, res) => { ... };

## 3. Handler-level — one handler via compose()

  import { compose } from 'express-file-cluster';

  export const POST = compose(
    validateBody(CreateUserSchema),
    async (req, res) => {
      // req.body is validated
    },
  );`,
  },

  // ── ignite() ──────────────────────────────────────────────────────────────
  'efc://docs/ignite': {
    name: 'ignite',
    description: 'Full ignite() bootstrapper API — all options documented.',
    content: `# ignite() — EFC Bootstrapper

One call bootstraps everything: routing, clustering, auth, DB, tasks.

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

    cluster: true,       // false → single process (auto-disabled in dev)
    workers: 4,          // defaults to os.cpus().length

    tasks: {
      backend: 'bullmq',
      redisUrl: process.env.REDIS_URL,
      concurrency: 5,
    },

    globalMiddlewares: [],
    onWorkerReady: (id) => console.log('Worker ' + id + ' ready'),
    onWorkerCrash: (id, code) => console.error('Worker ' + id + ' crashed (' + code + ')'),
  });

## Options Reference

| Option             | Type                          | Default             | Description                                  |
|--------------------|-------------------------------|---------------------|----------------------------------------------|
| port               | number                        | 3000                | HTTP listen port                             |
| apiDir             | string                        | —                   | Path to route modules (src/api/)             |
| tasksDir           | string                        | —                   | Path to task modules (src/tasks/)            |
| database           | 'mongodb' | 'postgresql'      | —                   | Database engine                              |
| databaseUrl        | string                        | DATABASE_URL env    | Connection string                            |
| authStrategy       | 'http-only' | 'localStorage'  | —                   | Token delivery method                        |
| jwtSecret          | string                        | JWT_SECRET env      | JWT signing secret                           |
| cluster            | boolean                       | true                | Enable multi-core clustering                 |
| workers            | number                        | os.cpus().length    | Worker count override                        |
| tasks              | TaskConfig | false            | false               | Background task runtime config               |
| cors               | boolean | CorsConfig         | true                | CORS — origins via CORS_ORIGINS env          |
| globalMiddlewares  | RequestHandler[]              | []                  | Applied to every route                       |
| onWorkerReady      | (id) => void                  | —                   | Called when a worker boots                   |
| onWorkerCrash      | (id, code) => void            | —                   | Called before respawn                        |
| onError            | ErrorRequestHandler           | built-in            | Override global error handler                |`,
  },

  // ── Auth ──────────────────────────────────────────────────────────────────
  'efc://docs/auth': {
    name: 'auth',
    description: 'Authentication strategies: http-only cookies and localStorage/Bearer tokens.',
    content: `# EFC Authentication

## Strategy 1: http-only (recommended for SSR/SSG)

Tokens stored in HttpOnly + Secure + SameSite=Strict cookies.

  import { issueToken, revokeToken, requireAuth } from 'express-file-cluster/auth';

  // src/api/auth/login.ts
  export const POST = async (req, res) => {
    const user = await verifyCredentials(req.body);
    issueToken(res, { sub: user.id, role: user.role });
    res.json({ message: 'Logged in' });
  };

  // src/api/auth/logout.ts
  export const POST = async (req, res) => {
    revokeToken(res);
    res.json({ message: 'Logged out' });
  };

  // Protect a route — put in any route file
  export const middlewares = [requireAuth];

## Strategy 2: localStorage (SPA-friendly)

Token returned in body; client attaches Authorization: Bearer <token>.

  import { signToken } from 'express-file-cluster/auth';

  export const POST = async (req, res) => {
    const user = await verifyCredentials(req.body);
    const token = signToken({ sub: user.id, role: user.role });
    res.json({ token });
  };

## Environment Variables

| Variable       | Required | Description                              |
|----------------|----------|------------------------------------------|
| JWT_SECRET     | Yes      | Signing key (auto-generated by scaffold) |
| JWT_EXPIRES_IN | No       | Token lifetime, default 7d               |
| COOKIE_DOMAIN  | No       | Cookie domain for http-only strategy     |`,
  },

  // ── Background Tasks ──────────────────────────────────────────────────────
  'efc://docs/tasks': {
    name: 'tasks',
    description: 'Background task system — defineTask, enqueue, thread workers, cron schedules.',
    content: `# EFC Background Tasks

Tasks run off the request path — respond immediately, let the queue handle the work.

## Define a Task

  // src/tasks/SendEmail.ts
  import { defineTask } from 'express-file-cluster/tasks';

  interface Payload { to: string; subject: string; body: string }

  export default defineTask<Payload>(async (payload) => {
    await mailer.send(payload);
  });

## CPU-bound Task (worker_threads)

  // src/tasks/ResizeImage.ts
  export default defineTask<{ key: string; width: number }>(
    { thread: true },
    async ({ key, width }) => {
      const buf = await sharp(await download(key)).resize(width).toBuffer();
      await upload(key + '@' + width, buf);
    },
  );

## Enqueue from a Route Handler

  import { enqueue } from 'express-file-cluster/tasks';

  export const POST = async (req, res) => {
    const user = await User.create(req.body);
    await enqueue('SendEmail', { to: user.email, subject: 'Welcome!', body: '...' });
    res.status(202).json({ id: user.id, queued: true });
  };

## Task Options

| Option      | Default      | Description                                       |
|-------------|--------------|---------------------------------------------------|
| thread      | false        | Run in worker_threads (CPU-bound work)            |
| retries     | 3            | Retry attempts before dead-lettering              |
| backoff     | 'exponential'| Delay strategy between retries                   |
| concurrency | tasks.concurrency | Parallel jobs for this task              |
| schedule    | —            | Cron expression for recurring tasks               |

## Cron Task Example

  export default defineTask<void>(
    { schedule: '0 9 * * 1' }, // every Monday at 09:00
    async () => {
      await sendWeeklyDigest();
    },
  );`,
  },

  // ── CLI ───────────────────────────────────────────────────────────────────
  'efc://docs/cli': {
    name: 'cli',
    description: 'Complete EFC CLI command reference.',
    content: `# EFC CLI Reference

## Development

  efc start dev          # Hot-reload single process, source maps, pretty logs

## Production

  efc build prod         # Type-check + compile to dist/ (tsup, dual CJS/ESM)
  efc start prod         # Run dist/ with clustering enabled

## Tests

  efc run tests          # Vitest (--watch, --coverage passthrough)

## Code Generation

  efc generate route users/[id]        # → src/api/users/[id].ts
  efc generate task ProcessPayment     # → src/tasks/ProcessPayment.ts
  efc generate middleware authorize    # → src/middlewares/authorize.ts

## Diagnostics

  efc routes             # Print resolved route table (path → file → methods)
  efc tasks              # List registered background tasks
  efc doctor             # Validate config, env vars, DB connectivity`,
  },

  // ── Clustering ────────────────────────────────────────────────────────────
  'efc://docs/clustering': {
    name: 'clustering',
    description: 'Multi-core clustering architecture — master/worker model and lifecycle.',
    content: `# EFC Clustering Architecture

EFC uses Node.js cluster module to fork one worker per CPU core.

              Master Process
         ┌────────────────────┐
         │  fork × N workers  │
         │  respawn on crash  │
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

CPU-bound tasks fan out further into worker_threads — the request loop
stays unblocked at every layer.

## Configuration

  ignite({
    cluster: true,        // enable (auto-disabled in dev mode)
    workers: 4,           // default: os.cpus().length
    onWorkerReady: (id) => console.log('Worker ' + id + ' ready'),
    onWorkerCrash: (id, code) => console.error('Worker ' + id + ' crashed (' + code + ')'),
  });`,
  },

  // ── Error Handling ────────────────────────────────────────────────────────
  'efc://docs/errors': {
    name: 'errors',
    description: 'HttpError class and custom global error handler.',
    content: `# EFC Error Handling

## HttpError

Throw from any handler — automatically caught, formatted, and returned as JSON.

  import { HttpError } from 'express-file-cluster';

  export const GET = async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw new HttpError(404, 'User not found');
    res.json(user);
  };

Response:
  HTTP/1.1 404 Not Found
  Content-Type: application/json

  { "error": "User not found", "statusCode": 404 }

## Custom Global Error Handler

  ignite({
    onError: (err, req, res, next) => {
      logger.error(err);
      res.status(err.statusCode ?? 500).json({ error: err.message });
    },
  });`,
  },

  // ── Environment Variables ─────────────────────────────────────────────────
  'efc://docs/env': {
    name: 'env',
    description: 'All supported environment variables and their defaults.',
    content: `# EFC Environment Variables

create-efc-app generates .env (gitignored, JWT_SECRET pre-filled) and
.env.example (committed, documented).

| Variable       | Required              | Description                                            |
|----------------|-----------------------|--------------------------------------------------------|
| PORT           | No (default 3000)     | HTTP listen port                                       |
| NODE_ENV       | No                    | development | production | test                        |
| DATABASE_URL   | Yes                   | MongoDB or PostgreSQL connection string                |
| JWT_SECRET     | Yes                   | JWT signing key — auto-generated by scaffolder         |
| JWT_EXPIRES_IN | No (default 7d)       | Token lifetime                                         |
| COOKIE_DOMAIN  | No                    | Cookie domain for http-only auth                       |
| REDIS_URL      | If using BullMQ       | Redis connection for the task queue                    |
| CORS_ORIGINS   | No                    | Comma-separated allowed origins                        |`,
  },

  // ── Roadmap ───────────────────────────────────────────────────────────────
  'efc://docs/roadmap': {
    name: 'roadmap',
    description: 'EFC development roadmap and release phases.',
    content: `# EFC Roadmap

| Phase | Target  | Focus                                                          |
|-------|---------|----------------------------------------------------------------|
| 0     | Done    | Design & planning ✅                                           |
| 1     | Q3 2026 | Core MVP — router, clustering, auth, DB, tasks, CLI            |
| 2     | Q4 2026 | Beta — PostgreSQL, Zod validation, structured logging, cron    |
| 3     | Q1 2027 | Stable v1.0 — plugins, WebSockets, OpenAPI, OpenTelemetry      |
| 4     | 2027+   | Edge/serverless, gRPC, GraphQL                                 |

Current version: v0.2.x (Beta)`,
  },
};
