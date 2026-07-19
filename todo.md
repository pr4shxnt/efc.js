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
- [x] **MongoDB adapter** — connect mongoose in Pre-Flight, expose `db` as `mongoose.Connection`
- [x] **`defineModel`** — unified CRUD surface compiling to mongoose schema
- [x] Normalised record shape (`id` mapped from `_id`)
- [x] `enum` field constraint — verified via `validateSync()` (2026-07-19)
- [x] `objectId` + `ref` + `.populate()` support
- [x] Typed arrays (`of`) incl. `objectId` arrays with `ref`
- [x] Nested array-of-subdocument schemas (`field: [{...}]`) — verified sub-field `required` validation fires correctly
- [ ] **Schema-level "operator code" defaults** (e.g. `default: '$now'` / `'$uuid'`-style sentinels) — does NOT exist; only raw values or raw functions work as `default`, and function defaults are an undocumented/untyped side effect of `default?: unknown`, not a designed feature
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
- [x] **`tasksDir` scanner** — auto-import task files on startup, register into `taskRegistry`
- [x] **BullMQ backend** — wire `setEnqueueImpl` to a real BullMQ queue + worker
- [ ] pg-boss backend — Phase 2
- [x] `thread: true` → `worker_threads` execution for CPU-bound tasks
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
- [x] Generates default admin/user panels and auth routes
- [x] Generates example task (`src/tasks/SendEmail.ts`) when tasks enabled
- [x] Runs `npm install` after scaffold
- [ ] End-to-end test of the full scaffold flow

### 1.9 Testing

- [x] Unit tests: route scanner (`scan.test.ts`)
- [x] Unit tests: route mount (`mount.test.ts`)
- [x] Unit tests: task scanner (`scanner.test.ts`)
- [x] Unit tests: auth (`auth/index.test.ts`)
- [x] Unit tests: `ignite()` (`ignite.test.ts`)
- [x] Unit tests: `defineModel` schema compilation — enum / nested-array / defaults / all `$`-operator codes / `ModelOptions.timestamps` (`db/model.smoke.test.ts`, added + expanded 2026-07-19) — schema-only, no live DB needed
- [x] Integration: `defineModel` against a real local MongoDB — sequence/`$increment`, `$currentUser`, `update()` (`db/model.integration.test.ts`, added 2026-07-19) — self-skips when Mongo isn't reachable; 7 files / 45 tests total as of this update
- [ ] Integration: static / index / dynamic route resolution
- [ ] Integration: clustering respawn
- [ ] Integration: task enqueue → process → retry
- [ ] Integration: auth middleware (issue + verify + revoke)

---

## Phase 1 Exit Criteria (not yet met)

- [ ] `npx create-efc-app` works end-to-end without manual steps
- [x] `efc start dev` serves routes (binary wired, tsx delegation works)
- [x] `enqueue('SendEmail', …)` runs off the request path with retries
- [x] Clustering spawns correct worker count and respawns on crash
- [ ] `efc run tests` is green in CI

---

## Phase 1 Review Follow-ups (found 2026-07-19)

Verified with real repros against the built package (not just reading code) while re-checking Phase 1 completion for the MongoDB adapter, BullMQ tasks, and clustering.

- [x] **Fix `efc start dev` NODE_ENV ordering bug** — `packages/core/src/cli/commands/start.ts` now sets `NODE_ENV: 'development'` *after* `...process.env`, so it always wins regardless of an inherited `NODE_ENV=production`. Verified with the same repro that found the bug; typecheck + full test suite green. (Fixed 2026-07-19)
- [x] **Fix `efc doctor` false-negative on DATABASE_URL/JWT_SECRET** — `doctorCommand` in `packages/core/src/cli/commands/diagnostics.ts` checked `process.env` directly, but `efc doctor` never loads `.env` (unlike `efc start dev`, which injects it into a spawned child only). Added `readEnvFile()` so doctor checks both `process.env` and a parsed `.env` in cwd. Verified against the real `usage/` app — previously showed both as missing despite being set in `usage/.env`, now passes. (Fixed 2026-07-19)
- [x] **Schema-level "operator code" defaults** for `defineModel` — implemented `'$now'` (→ `new Date()`), `'$uuid'` (→ `crypto.randomUUID()`), `'$objectId'` (→ fresh Mongoose `ObjectId`), `'$timestamp'` (→ `Date.now()` number), `'$shortId'` (→ random base64url string) as sentinel strings resolved to per-document generator functions in `db/model.ts` (`resolveDefault`/`STATIC_DEFAULT_OPERATORS`). New `DefaultOperator` type exported from `types.ts` and the main entrypoint. Documented in `docs/api-reference/db.md` and `Skills/efc/api-surface.md`. Covered by `db/model.smoke.test.ts` (fresh-per-document generation, literal strings unaffected). (Added/expanded 2026-07-19)
- [x] **`defineModel` `ModelOptions` third argument** — `timestamps` was previously hardcoded to `{ timestamps: true }` with no way to disable or rename `createdAt`/`updatedAt`. Added `defineModel(name, schema, options?: ModelOptions)`; `options.timestamps` accepts `true | false | { createdAt?, updatedAt? }`, passed straight through to mongoose. Default unchanged (`true`), so existing models are unaffected. Exported `ModelOptions` from `types.ts` and the main entrypoint; documented in `docs/api-reference/db.md` (`ModelOptions` section) and `docs/guides/database.md`. Covered by `db/model.smoke.test.ts`. (Added 2026-07-19)
- [x] **`sequence` field option (real `$increment`)** — `FieldDefinition.sequence?: boolean | string`. `true` keys an internal atomic counter as `'<ModelName>.<field>'`; a string sets an explicit shared key. Assigned in a `pre('validate')` hook (before `required` runs, only on new docs, only when not already set) — not a `default` code, since `default` resolves synchronously and an auto-increment needs an async read-modify-write against a counters collection (`efc_counters`, `$inc` + upsert — safe under concurrent inserts). Top-level fields only, not inside nested array sub-schemas. Verified against a real local MongoDB (`db/model.integration.test.ts`): sequential uniqueness, shared counter keys across models, and explicit values aren't clobbered. (Added 2026-07-19)
- [x] **Request context + `$currentUser`/`$currentUser.<key>` default codes** — added `packages/core/src/context.ts` (`AsyncLocalStorage`-backed), wired into `ignite()` (every request wrapped before any other middleware) and `requireAuth` (populates the context with the verified JWT payload). Exported `getCurrentUser()` from `express-file-cluster/auth`. `default: '$currentUser'` resolves to the full payload; `` `$currentUser.<key>` `` plucks one field (e.g. `'$currentUser.id'`); both resolve to `undefined` outside a request / without `requireAuth`, never throw. This is a real capability change — `Skills/efc/what-not-to-invent.md`'s old "no request context" claim removed and replaced with accurate current state. Verified three ways: live-Mongo integration tests (`runWithContext` + `.create()`), and a full real HTTP round trip (`ignite()` → Bearer JWT → `requireAuth` → route handler → `.create()` → correct `createdBy`, status 201). (Added 2026-07-19)
- [x] Fixed a drive-by mongoose deprecation warning (`{ new: true }` → `{ returnDocument: 'after' }`) in both the new `nextSequence` counter helper and the pre-existing `update()` CRUD method, discovered while adding the sequence feature. Added an `update()` integration test — previously untested against a live DB. (Fixed 2026-07-19)
- [x] **Updated the marketing site's "Workspace" demo** (`client/workspace.js`) — its `FILES` object hardcodes its own copy of the model/route source shown in the simulated IDE (per its own header comment, "verbatim from /usage"), and was stale relative to `usage/` itself. Retrofitted the new features into natural, non-contrived spots: `User.verifyToken` and `Session.token` → `default: '$uuid'` (dropped the now-redundant manual `crypto.randomBytes()` calls in `register.ts`); `Admin` gained `adminNumber` (`sequence: true`) and `createdBy` (`default: '$currentUser.id'`), and `admin/admins/index.ts`'s `GET`/`POST` handlers were turned from TODO-stubs into real `Admin.find()`/`.create()` calls — the natural real-world case for both features together; `Role` demonstrates `ModelOptions.timestamps: false` paired with an explicit `createdOn: { default: '$now' }` field (the one non-redundant use of `$now`, only meaningful once auto-timestamps are off). Added a terminal-demo curl example showing the new response fields. Deliberately did **not** force `$objectId`/`$timestamp`/`$shortId` in — no natural fit found in this app's models; forcing them in would've meant contrived justifications. Every snippet was verified against the real framework over live HTTP requests before going in (not just checked for valid JS/HTML). (Updated 2026-07-19)
- [x] **Version bump**: `packages/core/package.json` `0.3.12` → `0.3.14` (checked `npm view express-file-cluster version` first — registry was already at `0.3.13`, one ahead of this repo's local `package.json`, so bumped to `0.3.14` to avoid a publish collision, not to `0.3.13`). `packages/create-efc-app` was **not** bumped — untouched this session — but note it has the same one-patch drift (local `0.4.12` vs published `0.4.13`); `publish.yml`'s "fail loudly if already published" guard will catch it if someone tries to publish before bumping. Synced version strings in `client/index.html` (hero badge + new changelog entry), `client/workspace.html` (status-bar chip), and `client/workspace.js` (demo `package.json`'s `express-file-cluster` dependency). Deliberately did **not** touch `README.md`, `packages/core/README.md`, `CLAUDE.md`, `docs/index.md`, or `Skills/efc/SKILL.md` — all still say "v0.3.10" (already stale before this session, flagged but out of scope; only `/client` was requested). (2026-07-19)
- [ ] **BullMQ `enqueue()` hangs indefinitely when Redis is unreachable** — reproduced: `enqueue('ValidTask', payload)` against an unreachable Redis never resolves or rejects (tested past 5s with no timeout). Unknown task names still fail fast (registry check is synchronous, unaffected). Not a crash — BullMQ/ioredis retry quietly in the background — but there's no fail-fast/circuit-breaker option, and nothing in the docs warns callers their request may hang. Explicitly deferred by product decision on 2026-07-19; revisit before Phase 1 exit.
- [ ] Note: `mongoose` peer dependency range is `>=8.0.0` but the pinned devDependency is `^9.7.2`; `validateSync()` already emits a v10-deprecation warning under v9.7.2 — worth deciding whether to bump the peer range or pin lower for the beta.
- [ ] `db/model.integration.test.ts` (sequence + `$currentUser`, real MongoDB) self-skips when no MongoDB is reachable — confirmed it does (tested with an unreachable `EFC_TEST_MONGO_URL`), so it won't break the existing `.github/workflows/ci.yml` (no Mongo service container wired up there). Still: CI currently gets zero coverage of this file. Add a Mongo service container to `ci.yml` to actually run it.

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

1. **Integration tests** — route resolution, clustering, task lifecycle
2. **GitHub Actions CI** — lint + test on every PR
3. **End-to-end scaffolding test** — ensure `create-efc-app` works flawlessly
