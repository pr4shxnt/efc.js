# EFC Documentation

**express-file-cluster (EFC)** is an opinionated backend framework built on Express. It removes routing ceremony, saturates every CPU core automatically, and ships a production-grade background-task subsystem — all from a single `ignite()` call.

> **Status: v0.2.1 — Beta.** The router, clustering, auth, and MongoDB adapter are implemented. PostgreSQL and additional task backends are in active development.

---

## What EFC solves

| Pain point | EFC's answer |
|---|---|
| Route registration boilerplate | The file tree **is** the route tree |
| Single-threaded Node under load | CPU-count auto-detection → worker processes |
| Blocking work on the request path | `enqueue()` ships it off-path with retries |
| Wiring DB, auth, and middleware by hand | `ignite()` bootstraps everything in one call |

---

## Documentation sections

| Section | What you'll find |
|---|---|
| [Getting Started](./getting-started/index.md) | Scaffold a project, understand the structure |
| [Core Concepts](./core-concepts/index.md) | The four pillars: routing, clustering, tasks, middleware |
| [API Reference](./api-reference/ignite.md) | Every exported function and type, fully documented |
| [Guides](./guides/authentication.md) | Deep-dives: auth, database, error handling, deployment |
| [CLI](./cli/index.md) | All `efc` commands with flags and examples |
| [Contributing](./contributing/index.md) | Roadmap, branch conventions, PR requirements |

---

## Five-minute overview

```bash
# 1. Scaffold
npx create-efc-app my-api
cd my-api

# 2. Run in dev mode (hot-reload, single process)
npm run dev          # → efc start dev

# 3. Drop a file → get a route
# src/api/users/[id].ts  →  GET /users/:id
```

```ts
// src/api/users/[id].ts
import type { Request, Response } from 'express';

export const GET = async (req: Request, res: Response) => {
  res.json({ id: req.params.id });
};
```

```ts
// src/index.ts
import { ignite, gracefulShutdown } from 'express-file-cluster';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

ignite({
  apiDir: path.join(__dirname, 'api'),
  cluster: true,
}).then(gracefulShutdown);
```

The framework scans `apiDir` on boot, derives route paths from file names, forks `os.cpus().length` worker processes, and handles `SIGTERM`/`SIGINT` gracefully — zero extra code required.
