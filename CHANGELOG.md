# Changelog

All three packages (`express-file-cluster`, `create-efc-app`, `express-file-cluster-mcp`) are released
together under one version. Newest first. The public site's changelog (`client/index.html#changelog`)
mirrors this file — see `AGENTS.md` §5.

## 0.9.3 — 2026-10-28

- **Fix:** `efc start prod` now loads `.env` from the working directory when one exists. Variables
  already set in the environment (Docker, Kubernetes, PaaS secrets) still win; the file only fills in
  what's missing. Before, a VPS deploy with just a `.env` booted without `DATABASE_URL`, `JWT_SECRET`, …

## 0.9.2 — 2026-10-28

**Security: zero `npm audit` findings, in the repo and in scaffolded apps.**

- **New:** `hashPassword`, `verifyPassword` and `passwordNeedsRehash` in `express-file-cluster/auth` —
  scrypt from `node:crypto`, no native addon, nothing to install. Hashes store their own cost
  parameters (`scrypt$N$r$p$salt$key`, defaults N=2^15, r=8, p=1).
- **Changed:** `create-efc-app` and `efc add` (auth, admin users, password reset, OAuth, custom
  entities via `efc add auth:<name>`) generate code using these helpers and no longer add `bcrypt` /
  `@types/bcrypt`. `bcrypt` 5 pulled in a vulnerable `tar` through `@mapbox/node-pre-gyp`.
- **Upgrading an existing app:** to drop `bcrypt` too, switch your auth routes to
  `hashPassword`/`verifyPassword` (or re-add them with `efc add auth --overwrite`) and uninstall
  `bcrypt` / `@types/bcrypt`. There is **no bcrypt fallback**: `verifyPassword` returns `false` for old
  `$2b$` hashes (and logs a warning), so existing users reset their password once — the reset stores a
  scrypt hash. New apps depend on `express-file-cluster@^0.9.2`.
- **Scaffolded apps:** the email client now installs `nodemailer@^10.2.1` (was `^6.9.0`, which has
  open advisories; needs Node 20+) with `@types/nodemailer@^8`. TypeScript apps get
  `"overrides": { "esbuild": "^0.28.1" }`, because tsup 8 still asks for an esbuild 0.27 with an advisory.
  Existing apps: bump `nodemailer` and add the same override yourself, then `npm install`.
- **Dependencies:** lockfile refreshed — `zod` 4.6.7, `vitest` 4.1.12, `vite` 8.3, and patched `qs`,
  `body-parser`, `brace-expansion`, `fast-uri`, `js-yaml`, `nanoid`, `postcss`, `source-map-js`.
  `express-file-cluster-mcp` now requires `zod@^4.6.7`.

## 0.9.1 — 2026-10-27

- `defineCollection(name, schema, options)` — a MongoDB-native model with the mongoose vocabulary
  (`find` with projection/sort/populate, `findOneAndUpdate`, `bulkWrite`, `aggregate`, `watch`) and BSON
  types (`decimal128`, `long`, `geoPoint`, `binary`, 2dsphere/text/hashed indexes).
- Custom authenticatable entities: `efc add auth:<name>` (also `--entity <name>`, `auth new <name>`)
  generates a model and `/auth/<name>/register | login | logout | me`.
- Guides: Coming from mongoose; Which model API? covers all three APIs.

## 0.9.0 — 2026-10-23

`efc db generate` writes migrations from model changes. Plus `efc db pull`, `efc import-prisma`, pool
settings (`databasePool`) and a relations guide.

## 0.8.0 — 2026-10-23

`efc add`: auth, portals, billing and more, copied into your app as source you own.

## 0.7.1 — 2026-10-16

The scaffolder generates `defineTable` models with foreign keys on PostgreSQL.

## 0.7.0 — 2026-10-16

Relations for `defineTable`: foreign keys, many-to-many, `include`. Query logging.

## 0.5.0 — 2026-10-15

Types inferred from schemas, `defineTable`, and an MCP server for the docs.

## 0.3 — 2026-07-02

Auth routes and `requireAuth('role')`, typed schema fields, default operators and sequences.

## 0.2 — 2026-06-23

User and admin portals, RBAC, the route docs dashboard and the mailer in the scaffolder.

## 0.1 — 2026-06-22

First release: file-based routing, clustering, background tasks and JWT auth.
