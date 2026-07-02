# EFC — What Does NOT Exist

This module is the anti-hallucination guard. Before suggesting, generating, or writing EFC code, check this list. If something appears here, **it does not exist in the codebase** — do not generate it, reference it, or imply it works.

---

## Import paths that do NOT exist

```ts
// ❌ DOES NOT EXIST
import { ... } from 'express-file-cluster/db'
import { ... } from 'express-file-cluster/router'
import { ... } from 'express-file-cluster/cluster'
import { ... } from 'express-file-cluster/middleware'
import { ... } from 'express-file-cluster/errors'
import { ... } from 'express-file-cluster/config'
import { ... } from 'express-file-cluster/models'
```

Only three sub-paths exist: (no suffix), `/auth`, `/tasks`.

---

## Functions that do NOT exist

```ts
// ❌ NOT exported from any EFC path
createApp()
createServer()
useMiddleware()
addRoute()
registerRoute()
mountRoute()
defineRoute()
defineMiddleware()
defineModel()          // ← WAIT — this DOES exist, from main path
createModel()          // ← does NOT exist (it's defineModel, not createModel)
getModel()             // ← does NOT exist as a public export
useDatabase()
connectDatabase()
createTask()           // ← does NOT exist (it's defineTask)
addTask()
scheduleTask()         // ← does NOT exist yet (schedule option exists but no scheduler impl)
withAuth()             // ← does NOT exist
protect()              // ← does NOT exist
authenticate()         // ← does NOT exist (it's requireAuth)
```

---

## Configuration patterns that do NOT exist

```ts
// ❌ No automatic efc.config.ts loading — ignite() does NOT read efc.config.ts
// The config file is informational only. You must import it yourself and pass it:
import config from './efc.config';
ignite(config);   // you wire this yourself

// ❌ No global middleware file (middlewares.ts or similar)
// Middleware is only wired via ignite({ globalMiddlewares }) or route exports

// ❌ No src/middleware/ auto-scanning
// EFC does NOT automatically scan a middlewares directory

// ❌ No plugins system yet (Phase 3)
ignite({ plugins: [...] })     // does NOT exist

// ❌ No request context / AsyncLocalStorage provided by EFC
import { ctx } from 'express-file-cluster'   // does NOT exist
```

---

## Route file features that do NOT exist

```ts
// ❌ Named exports other than HTTP methods and 'middlewares' are NOT special
export const config = { ... }         // ignored
export const schema = { ... }         // ignored
export const meta = { ... }           // ignored
export const description = '...'      // ignored

// ❌ Default export is NOT used by the router
export default async function(req, res) { ... }   // NOT called as a route handler

// ❌ Wildcard/catch-all routes not implemented (Phase 2)
// src/api/[...params].ts   → DOES NOT WORK YET
// src/api/blog/[...slug].ts → DOES NOT WORK YET

// ❌ Optional dynamic segments not implemented (Phase 2)
// src/api/users/[[id]].ts  → DOES NOT WORK YET
```

---

## Task features that do NOT exist

```ts
// ❌ Task sub-directories not scanned
// src/tasks/email/SendEmail.ts   → NOT registered (only top-level files)

// ❌ Cron/schedule not implemented (Phase 2)
// defineTask({ schedule: '0 * * * *' }, handler) → option accepted but NOT executed

// ❌ pg-boss backend not implemented (Phase 2)
ignite({ tasks: { backend: 'pg-boss' } })  // will fail at runtime

// ❌ No enqueue from within a task is blocked, but there's no built-in parent/child job tracking
```

---

## CLI commands that do NOT exist

```bash
efc db migrate      # NOT IMPLEMENTED (Phase 2)
efc db rollback     # NOT IMPLEMENTED
efc db seed         # NOT IMPLEMENTED
efc db studio       # NOT IMPLEMENTED
efc lint            # NOT IMPLEMENTED
efc deploy          # NOT IMPLEMENTED
efc --version       # may not be wired — check package.json
```

Implemented commands: `start dev`, `start prod`, `build prod`, `run tests`, `generate route/task/middleware`, `routes`, `tasks`, `doctor`.

---

## Database features that do NOT exist

```ts
// ❌ PostgreSQL adapter not implemented (Phase 2)
ignite({ database: 'postgresql', databaseUrl: process.env.DATABASE_URL })
// → connects nothing; only 'mongodb' is implemented

// ❌ No transaction support in defineModel
// No defineModel().transaction(...) or similar

// ❌ No migration system
// defineModel does NOT create tables or run schema migrations
// (for MongoDB it creates collections lazily via Mongoose; for Postgres: unimplemented)

// ❌ db.query() is NOT guaranteed to exist
// db is typed as AnyClient = Record<string, unknown>
// What methods are available depends entirely on what mongoose.Connection exposes
```

---

## Auth features that do NOT exist

```ts
// ✅ requireAuth('admin') DOES exist — it's an overload, not a separate function.
// Bare `requireAuth` just verifies the JWT. Called with role names it returns a
// middleware that also checks payload.role. Both forms use the same export.

// ❌ No refresh token mechanism in the framework itself
// (the create-efc-app scaffolder generates an app-level /auth/refresh route
// that stores a rotating refresh token in the DB — that's app code, not core)
refreshToken()          // does NOT exist as a core export

// ❌ No token blocklist / invalidation list
// revokeToken() only clears the cookie — the JWT remains cryptographically valid

// ❌ No per-route strategy override
// authStrategy is global — set once in ignite()
```

---

## Environment variables that EFC does NOT read automatically

```
REDIS_URL         — NOT read by ignite(); pass tasks.redisUrl explicitly
                    (or read it yourself: tasks: { redisUrl: process.env.REDIS_URL })
```

---

## Common wrong patterns

```ts
// ❌ Calling enqueue without configuring tasks in ignite()
ignite({ apiDir: '...' })   // no tasks config
await enqueue('SendEmail', payload)  // throws: Task queue not initialised

// ❌ Calling requireAuth before ignite() / configureAuth()
// In tests that mount handlers without calling ignite(), requireAuth will throw

// ❌ Accessing db before Pre-Flight completes
// In module-level or import-time code:
const conn = db.model('User')  // throws: db not ready

// ❌ Passing a relative path to apiDir
ignite({ apiDir: './src/api' })  // WRONG in production — use path.join(__dirname, 'api')
// (works in dev with tsx because cwd is the project root, but breaks in dist/)
```
