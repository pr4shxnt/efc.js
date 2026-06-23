# EFC — Routing Rules (Exact)

Source: `packages/core/src/router/scan.ts` + `packages/core/src/router/mount.ts`

---

## File → URL transformation (exact algorithm)

```
scan.ts: filePathToUrlPath(relativePath)

1. Strip extension   (.ts | .js | .mts | .mjs | .cts | .cjs)
2. Strip /index      (trailing /index becomes '')
3. Replace [param]   → :param  (regex: /\[([^\]]+)\]/g)
4. If result is ''   → '/'
5. If result doesn't start with '/'  → prepend '/'
```

### Examples derived from the exact regex

| File (relative to apiDir) | URL |
|---|---|
| `/health.ts` | `/health` |
| `/users/index.ts` | `/users` |
| `/users/[id].ts` | `/users/:id` |
| `/posts/[slug]/comments.ts` | `/posts/:slug/comments` |
| `/index.ts` | `/` |
| `/auth/login.ts` | `/auth/login` |
| `/a/[b]/[c].ts` | `/a/:b/:c` |

**Edge case:** `/users/index.ts` → strips extension → `/users/index` → strips `/index` → `/users`. NOT `/users/`. There is no trailing slash.

---

## Sorting: static before dynamic

```ts
entries.sort((a, b) => {
  const aDynamic = a.urlPath.includes(':') ? 1 : 0;
  const bDynamic = b.urlPath.includes(':') ? 1 : 0;
  return aDynamic - bDynamic || a.urlPath.localeCompare(b.urlPath);
});
```

Static routes register on Express before dynamic routes **at all levels** — not just the same segment. `/users/me` will always beat `/users/:id` for a request to `/users/me`.

---

## Method dispatching (mount.ts)

Recognised method names (exact — case-sensitive uppercase):
```
GET  POST  PUT  PATCH  DELETE  HEAD  OPTIONS
```

For each route module:
1. Import the module dynamically.
2. Read `mod.middlewares` (must be an array, else ignored).
3. For each of the 7 method names, check `typeof mod[METHOD] === 'function'`.
4. Register matching methods: `app[method.toLowerCase()](urlPath, ...middlewares, asyncWrap(handler))`.
5. If **any** methods are implemented and **any** are unimplemented: register `app.all(urlPath, ...)` that returns 405 with `Allow: <implemented>` for the missing methods.

**asyncWrap**: `Promise.resolve(handler(req, res, next)).catch(next)` — all route errors auto-forwarded.

---

## `middlewares` export rules

```ts
export const middlewares = [mw1, mw2]; // ✅ valid — applied to all methods
export const middlewares = mw1;         // ❌ ignored — must be an array
```

The check in mount.ts: `Array.isArray(mod['middlewares'])`.

---

## Route file extensions accepted

```
.ts  .js  .mts  .mjs  .cts  .cjs
```

Regex: `/\.(ts|js|mts|mjs|cts|cjs)$/`

Files that do NOT match this pattern are silently ignored by `scanDir`.

---

## What scanDir does NOT do

- Does NOT follow symlinks (uses `fs.readdirSync` with `withFileTypes`).
- Does NOT skip files named `index.ts` specially during scan — they are treated as routes whose URL resolves to the parent directory path.
- Does NOT support nested `index` files as catch-alls — only the exact directory name maps to the URL.
- Does NOT support wildcard/catch-all routes (`[...params]`) — that feature is planned for Phase 2.

---

## 405 response format

```json
{ "error": "Method Not Allowed" }
```

Header: `Allow: GET, POST` (only the implemented methods).

**Only sent when at least one method IS implemented.** A file that exports no HTTP methods gets no 405 handler — Express would return 404.
