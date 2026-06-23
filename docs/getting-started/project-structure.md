# Project Structure

A scaffolded EFC project looks like this:

```
my-api/
├── src/
│   ├── api/                       # HTTP routes — every file here is a route
│   │   ├── health.ts              # GET /health
│   │   ├── users/
│   │   │   ├── index.ts           # GET /users  •  POST /users
│   │   │   └── [id].ts            # GET /users/:id  •  DELETE /users/:id
│   │   └── posts/
│   │       └── [slug]/
│   │           └── comments.ts    # GET /posts/:slug/comments
│   ├── tasks/                     # Background jobs
│   │   ├── SendEmail.ts           # task name: "SendEmail"
│   │   └── ResizeImage.ts         # task name: "ResizeImage" (CPU-bound)
│   ├── models/                    # Engine-agnostic data models
│   │   └── User.ts
│   ├── middlewares/               # Reusable middleware helpers
│   │   └── auth.ts
│   └── index.ts                   # Framework entry point
├── efc.config.ts                  # Structural configuration
├── .env                           # Real secrets — gitignored
├── .env.example                   # Documented template — safe to commit
├── .gitignore
├── package.json
└── tsconfig.json
```

---

## `src/api/` — Route modules

Every `.ts` (or `.js`) file inside `apiDir` becomes a route. The URL path is derived from the file path relative to `apiDir`:

| File | URL |
|---|---|
| `api/health.ts` | `/health` |
| `api/users/index.ts` | `/users` |
| `api/users/[id].ts` | `/users/:id` |
| `api/posts/[slug]/comments.ts` | `/posts/:slug/comments` |

Files named `index.ts` inside a directory map to the directory's URL (no `/index` suffix).
`[bracket]` segments become Express `:param` segments.

See [File-Based Routing](../core-concepts/file-based-routing.md) for the complete rule set.

---

## `src/tasks/` — Background task modules

Every file inside `tasksDir` registers a named background task. The task name is the file's basename without extension:

| File | Task name |
|---|---|
| `tasks/SendEmail.ts` | `"SendEmail"` |
| `tasks/ResizeImage.ts` | `"ResizeImage"` |

Tasks must export a default `TaskDefinition` created with `defineTask()`.

See [Background Tasks](../core-concepts/background-tasks.md).

---

## `src/models/` — Data models

Engine-agnostic model definitions using `defineModel()`. The same model works against MongoDB (via `mongoose`) and PostgreSQL (via Drizzle) without modification.

See [Database Guide](../guides/database.md).

---

## `src/index.ts` — Entry point

The single call that boots the framework:

```ts
import { ignite, gracefulShutdown } from 'express-file-cluster';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

ignite({
  cluster: true,
  workers: 2,
  apiDir: path.join(__dirname, 'api'),
  tasksDir: path.join(__dirname, 'tasks'),
  tasks: { backend: 'bullmq' },
})
  .then(gracefulShutdown)
  .catch(console.error);
```

`ignite()` reads `PORT`, `DATABASE_URL`, `JWT_SECRET`, and `CORS_ORIGINS` from `process.env` automatically — no explicit wiring needed if the env vars are set.

See [`ignite()` API reference](../api-reference/ignite.md).

---

## `efc.config.ts` — Structural configuration

The scaffolder generates a typed config file that captures structural choices (directories, auth strategy, task backend). Runtime secrets stay in `.env`.

```ts
import type { EFCConfig } from 'express-file-cluster';

const config: EFCConfig = {
  apiDir: './src/api',
  tasksDir: './src/tasks',
  authStrategy: 'http-only',
  tasks: { backend: 'bullmq', concurrency: 5 },
  globalMiddlewares: [],
};

export default config;
```

> `efc.config.ts` is currently informational — it documents intent. `src/index.ts` is the actual runtime entrypoint and imports from this config directly if you wire them together.

---

## `.env` and `.env.example`

`.env` is gitignored and holds real secrets. `.env.example` is committed and documents every required variable with placeholder values.

See [Environment Variables](../guides/environment-variables.md) for the full variable reference.
