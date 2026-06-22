# EFC — Implementation Checklist

> Status as of June 2026. Based on `plan.md` Phase 1 (Core MVP) target.

---

## Phase 0 — Design & Planning

- [x] Define core API (`ignite()` options, route + task conventions)
- [x] Write `plan.md`
- [ ] Decide package name & npm scope
- [ ] Set up contribution guidelines & repo standards
- [x] Choose test runner (Vitest) + CI setup

---

## Phase 1 — Core MVP

### 1.1 Project Bootstrap

- [x] Initialise monorepo (`packages/core`, `packages/create-efc-app`)
- [x] TypeScript build (`tsup`) + dual CJS/ESM output
- [x] ESLint + Prettier config
- [ ] GitHub Actions: lint + test on every PR
- [ ] `packages/adapters` package scaffold

### 1.2 File-Based Router

- [x] Recursive `apiDir` scan → route map (`router/scan.ts`)
- [x] Static / index / dynamic segment resolution (`[param]` → `:param`)
- [x] Method dispatching (uppercase export → HTTP verb)
- [x] Auto `405` for unimplemented verbs
- [x] Per-route `middlewares[]` injection
- [ ] Catch-all / wildcard routes (`[...params].ts`) — Phase 2

### 1.3 Clustering

- [x] Master forks `os.cpus().length` workers (`cluster/index.ts`)
- [x] Pre-Flight lifecycle wired in `ignite()` (DB → auth → routes → listen)
- [x] Self-healing respawn on worker crash
- [x] `onWorkerReady` / `onWorkerCrash` hooks
- [x] `cluster: false` single-process bypass

### 1.4 Database Adapters

- [x] `db` proxy export — thread-local client slot (`db/index.ts`)
- [ ] **MongoDB adapter** — connect mongoose in Pre-Flight, expose `db` as `mongoose.Connection`
- [ ] **`defineModel`** — unified CRUD surface compiling to mongoose schema
- [ ] Normalised record shape (`id` mapped from `_id`)
- [ ] PostgreSQL adapter (`pg` / Drizzle) — Phase 2

### 1.5 Auth + Errors

- [x] `http-only` strategy — `issueToken`, `revokeToken`, `requireAuth` (`auth/index.ts`)
- [x] `localStorage` strategy — `signToken` + Bearer verify
- [x] `HttpError` class (`errors.ts`)
- [x] Global error interceptor in `ignite()`
- [x] `compose()` handler-level middleware helper

### 1.6 Background Tasks

- [x] `defineTask` API — I/O-bound and CPU-bound (`tasks/index.ts`)
- [x] `enqueue` stub — throws until a backend is wired
- [x] `taskRegistry` map
- [ ] **`tasksDir` scanner** — auto-import task files on startup, register into `taskRegistry`
- [ ] **BullMQ backend** — wire `setEnqueueImpl` to a real BullMQ queue + worker
- [ ] pg-boss backend — Phase 2
- [ ] `thread: true` → `worker_threads` execution for CPU-bound tasks
- [ ] Cron/scheduled tasks (`schedule` option on `defineTask`)

### 1.7 CLI (`efc`)

- [x] `efc start dev` — spawns `node --watch` with `tsx`
- [x] `efc start prod` — runs `dist/index.js`
- [x] `efc build prod` — type-check + `tsup`
- [x] `efc run tests` — delegates to Vitest
- [x] `efc generate route <path>`
- [x] `efc generate task <name>`
- [x] `efc generate middleware <name>`
- [x] `efc routes` — print resolved route table
- [x] `efc tasks` — list registered tasks
- [x] `efc doctor` — validate config, env vars, project setup
- [ ] `efc db migrate / rollback / seed / studio` — Phase 2
- [ ] `efc --version` reads from `package.json` at runtime

### 1.8 Scaffolder (`create-efc-app`)

- [x] Interactive prompts (language, DB, auth, cluster, tasks, queue backend)
- [x] Generates `package.json`, `tsconfig.json`, `efc.config.ts`, entry point
- [x] Generates `.env` (random `JWT_SECRET`) + `.env.example` + `.gitignore`
- [x] Generates example route (`src/api/health.ts`)
- [x] Generates example task (`src/tasks/SendEmail.ts`) when tasks enabled
- [x] Runs `npm install` after scaffold
- [ ] End-to-end test of the full scaffold flow

### 1.9 Testing

- [x] Unit tests: route scanner (`scan.test.ts`) — 4 tests, all passing
- [ ] Integration: static / index / dynamic route resolution
- [ ] Integration: clustering respawn
- [ ] Integration: MongoDB connection lifecycle
- [ ] Integration: task enqueue → process → retry
- [ ] Integration: auth middleware (issue + verify + revoke)

---

## Phase 1 Exit Criteria (not yet met)

- [ ] `npx create-efc-app` works end-to-end without manual steps
- [x] `efc start dev` serves routes (binary wired, tsx delegation works)
- [ ] `enqueue('SendEmail', …)` runs off the request path with retries
- [x] Clustering spawns correct worker count and respawns on crash
- [ ] `efc run tests` is green in CI

---

## Phase 2 — Beta (Q4 2026)

- [ ] PostgreSQL adapter (Drizzle ORM)
- [ ] pg-boss task backend
- [ ] Catch-all / wildcard routes (`[...params].ts`)
- [ ] Request body validation (Zod integration)
- [ ] Structured logging (`pino`) with request IDs
- [ ] Scheduled/cron tasks
- [ ] Optional dynamic segments (`[[id]].ts`)
- [ ] `efc db migrate / rollback / seed / studio`
- [ ] Dead-letter inspection in `efc tasks`

---

## Phase 3 — Stable v1.0 (Q1 2027)

- [ ] Plugin system (`registerPlugin()`)
- [ ] WebSocket support (`export const WS = ...`)
- [ ] OpenAPI auto-generation from route exports
- [ ] OpenTelemetry distributed tracing
- [ ] `efc/testing` (`createTestApp()` for integration tests)
- [ ] `efc studio` — live route map + worker/queue dashboard
- [ ] Third-party security audit
- [ ] Benchmarks vs bare Express / Fastify
- [ ] Semver + LTS policy
- [ ] Docs site

---

## What to Build Next (Priority Order)

1. **MongoDB adapter** — `tasksDir` scanner and BullMQ backend are blocked until DB is wired; most example apps need this immediately
2. **`tasksDir` scanner** — auto-register task files on startup so `enqueue()` actually works
3. **BullMQ backend** — wire `setEnqueueImpl` so tasks run with retries/backoff
4. **`worker_threads` for CPU-bound tasks** — `thread: true` option
5. **Integration tests** — route resolution, clustering, task lifecycle
6. **GitHub Actions CI** — lint + test on every PR
