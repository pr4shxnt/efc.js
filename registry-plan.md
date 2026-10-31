# Plan: `efc add` — a shadcn-style feature registry (target: v0.8.0)

> Status: proposal (2026-10-18). Baseline: v0.7.1. Displaces M4/M5 of `prisma-parity-plan.md`
> by one minor release.

## How shadcn/ui works

shadcn/ui is a **code distribution system**, not a component library. You never install it as a
dependency. Its CLI copies source into your repo, and from then on the code belongs to you.

| Piece | What it does |
| --- | --- |
| `shadcn init` | Writes `components.json` (style, TS/JS, path aliases, Tailwind/CSS paths, registries), installs the base deps, writes `lib/utils.ts` and the CSS variables. That's the "base version". |
| Registry item | A JSON document: `name`, `type` (`registry:ui`, `:block`, `:hook`, `:lib`, `:page`…), `files[]` (path + content + target), `dependencies` (npm), `devDependencies`, `registryDependencies` (other items, by name or URL), `cssVars`, `tailwind` patches, `envVars`, `docs`. |
| `shadcn add button card` | Fetches each item's JSON, resolves `registryDependencies` recursively, installs the npm deps, rewrites import aliases to match `components.json`, writes the files and merges CSS vars. Asks before overwriting (`--overwrite` forces it). |
| Styles | The same item is published once per style (`new-york`, `default`), and `components.json` decides which variant you get. |
| Third-party registries | `shadcn build` turns a `registry.json` into static `r/<item>.json` files you can host anywhere. `components.json` maps namespaces (`@acme`) to URLs, so `shadcn add @acme/login-form` works. There's also `shadcn add <url>`. |
| `view` / `diff` / `list` / MCP | Inspect an item before adding it, diff it against upstream, search registries. The MCP server lets agents do the same. |
| Weak spot | There is no lockfile or record of what's installed. Updating means overwriting your edits or diffing by hand. |

The underlying idea: **a minimal base, then features added one at a time as source you own.**
Upgrades come as diffs, not as a version bump of a black-box package.

## Does it fit EFC? Yes, better than it fits UI

The data says yes:

- `create-efc-app` is already a registry, just one frozen at creation time. `scaffold.ts` is 3,924
  lines of templates behind roughly 25 feature flags (`UserFeatures`, `AdminFeatures`, `rbac`,
  `mailer`, `tasks`…). Today, if you skip billing at `create` and want it a month later, you have
  to re-scaffold a throwaway app and copy files across by hand.
- EFC features are already file-shaped. A route is a file under `src/api`, a task is a file under
  `src/tasks`, a model is a file under `src/model`. Discovery is by filesystem scan, so **adding a
  feature is mostly just dropping files in**. That's the exact property that makes shadcn work.
- Generated code is meant to be owned. Auth flows, billing and admin CRUD always get customised, so
  "copy it in and own it" beats hiding it inside a package.

Split:

- **The framework stays a dependency:** `express-file-cluster` (router, cluster, db, auth
  primitives, tasks). Nothing about shadcn applies to the runtime.
- **The app layer becomes a registry:** everything `create-efc-app` writes beyond the base.

## Where EFC is harder than shadcn (and the fixes)

UI components rarely touch each other. EFC features do. From `scaffold.ts`:

1. **Variant axes.** Templates branch on `language` (ts/js), `database` + `modelApi`
   (mongo / pg-defineModel / pg-defineTable, via `orm(opts)`), `authStrategy` and `routeDocs`.
   → Treat these like shadcn "styles". The build renders each item once per variant
   (`ts|js × mongo|pg-model|pg-table × cookie|bearer` = 12, with JS produced by stripping types
   from TS), and `efc.json` picks the variant.
2. **Conditional foreign keys.** `refField()` emits an FK only *if the target model is generated*
   (e.g. `Subscription.plan`). With incremental adds, that conditional would go stale.
   → Make them **hard `registryDependencies`** instead (`billing/subscriptions` requires
   `model/plan`). That means fewer shapes, and an FK is always an FK.
3. **Back-relations live on the parent.** `User.ts` lists `sessions`, `notifications`, `files`…
   under `relations`, filtered by which models exist (`relationsOption()`). Every feature would
   have to edit `User.ts`.
   → **Core addition:** declare the back-relation on the child, e.g.
   `user: { type: 'uuid', ref: 'User', backref: 'sessions' }` (Django's `related_name`). The child's
   file then carries everything, and `User.ts` never changes. Typed `include` needs declaration
   merging on `Tables`, which is the main risk in this plan. Fallback: patch primitive (b) below.
4. **Shared touch points:** `efc.config.ts` (tasks, cache, smtp), `.env`/`.env.example`,
   `src/model/index.ts` (registration + `Tables`), and the login route, which branches on
   user/admin.
   → Three edit primitives, in order of preference:
   - (a) **New files only.** Most items: routes, tasks, models, middleware.
   - (b) **Structural patches** through `magicast` (AST, idempotent): add a key to the
     `efc.config` object, append to an array, add an import. Each patch declares a fallback
     message. If the AST doesn't match because the user restructured the file, the CLI prints the
     manual edit and doesn't fail.
   - (c) **Managed files** regenerated from `efc.json`, with a "managed by efc — edits are
     overwritten" header: `src/model/index.ts`, and `src/auth/principals.ts` (the list of
     `{ model, role }` the login route iterates, replacing today's hard-coded branching).

## Design

### `efc.json` (the `components.json` equivalent, plus a lock)

```jsonc
{
  "$schema": "https://efc.prashantadhikari7.com.np/schema/efc.json",
  "language": "typescript",
  "database": "postgresql",
  "modelApi": "defineTable",
  "authStrategy": "http-only",
  "routeDocs": true,
  "paths": { "api": "src/api", "tasks": "src/tasks", "model": "src/model", "lib": "src/lib" },
  "registries": { "@acme": "https://registry.acme.dev/efc/{name}.json" },
  "installed": {
    "auth/login": { "version": "0.8.0", "files": { "src/api/auth/login.ts": "sha256-…" } }
  }
}
```

The `installed` hashes are what shadcn lacks. They let `efc diff` / `efc add --update` tell
"untouched, safe to replace" apart from "you edited this, here's the diff", and let `efc remove`
delete only the files you never touched.

### Registry item (EFC flavour of shadcn's schema)

```jsonc
{
  "name": "billing/subscriptions",
  "type": "efc:feature",            // efc:feature | efc:model | efc:route | efc:task | efc:lib
  "title": "Subscriptions & invoices",
  "requires": { "auth": true },     // variant constraints, e.g. { "database": "postgresql" }
  "registryDependencies": ["auth/core", "model/user", "model/plan"],
  "dependencies": { "stripe": "^17" },
  "files": [{ "path": "src/api/user/subscription/index.ts", "content": "…" }],
  "patches": [{ "file": "efc.config", "op": "setKey", "key": "billing", "value": "{ … }" }],
  "env": { "STRIPE_SECRET_KEY": { "example": "sk_test_…", "required": true } },
  "docs": "Set STRIPE_SECRET_KEY, then …"
}
```

### Commands (in the existing `efc` binary)

| Command | |
| --- | --- |
| `efc init` | Adds `efc.json` to an existing EFC app by detecting the variant from `package.json`/config. This is the migration path for apps made with ≤ 0.7. |
| `efc add <item…>` | Resolve deps → show the plan (files, npm deps, patches, env) → confirm → write, install, patch, regenerate managed files. Flags: `--dry-run`, `--overwrite`, `--yes`. Accepts `@ns/item` and URLs. |
| `efc list` / `efc view <item>` | Browse, and preview files rendered for *your* variant. |
| `efc diff [item]` / `efc add <item> --update` | Compare against the registry version, using the hashes. |
| `efc remove <item>` | Remove the item's untouched files, reverse its patches, regenerate managed files. Never drops tables. |

`efc generate route|task|…` stays as it is, for blank files. `add` is for working features.

### Where the official registry lives

Bundle it into `express-file-cluster`'s `dist/registry/<variant>/<item>.json`, the same way
`docs/` is bundled today (`scripts/bundle-docs.mjs`). Items are then **versioned with the
framework you have installed**: no network, and no "latest registry vs. old framework" skew, which
is a real shadcn pain. Also publish them to `efc.prashantadhikari7.com.np/r/…` for browsing and
for `efc view` without installing. Third-party registries are static JSON over URL, as in shadcn.
`efc registry build` turns a `registry.json` + template files into that output.

### Source of truth

Move the templates out of `scaffold.ts` into `packages/registry/items/<name>/` as template
modules (functions of the variant, keeping `orm(opts)`). A build step renders all variants to
JSON. **`create-efc-app` becomes `init` + `add <preset items>`.** Its prompts stay as they are,
but each answer maps to item names. So there's one code path and no drift between create-time
and add-time output.

## Item catalogue (from today's flags)

| Today | Items |
| --- | --- |
| base | `create-efc-app --minimal`: `package.json`, `tsconfig`, `efc.config`, `src/index`, `api/health`, `.env*`, `AGENTS.md`, `efc.json` |
| auth core | `auth/core` (login/logout/register, `principals.ts`), `model/user`, `model/admin` |
| userFeatures | `user/profile`, `auth/forgot-password`, `auth/security` (change pw, 2FA, sessions), `auth/verify-email`, `user/settings`, `user/notifications`, `user/files`, `billing/subscriptions` (+ api-keys), `support/tickets` |
| adminFeatures | `admin/users`, `admin/admins`, `admin/analytics`, `admin/content`, `admin/billing`, `admin/support`, `admin/audit-log`, `admin/system` |
| other flags | `rbac`, `mailer` (+ `SendEmail` task; upgrades the `TODO: email` stubs via a patch), `tasks/example`, `route-docs` |

## Milestones

- **R1: registry format + renderer.** Item schema (zod/JSON Schema), variant matrix, build to
  JSON. Port `scaffold.ts` templates into items. **Gate:** for every preset combination the
  current `scaffold.test.ts` covers, `create-efc-app` built on the registry produces
  **byte-identical** output to 0.7.1 (golden test). Any intended differences, such as
  `principals.ts`, land in a separate commit with the golden files updated.
- **R2: `efc init` / `efc add` / `efc.json`.** Dependency resolution, npm install through the
  detected package manager, file writes with hashes, managed-file regeneration, magicast patches
  with fallbacks, env merge. **Gate:** `create --minimal` followed by `efc add` of every item gives
  a project equivalent to the full preset (same files, same typecheck, same e2e).
- **R3: core `backref`.** Child-side back-relations for `defineTable`, including typing. If the
  typing can't be made to work, ship (b) patches on `User.ts` instead and note it.
- **R4: `list` / `view` / `diff` / `remove` / `--update`**, plus third-party registries
  (`registries` namespaces, URL items, `efc registry build`).
- **R5: surface.** MCP tools in `express-file-cluster-mcp` (`list_items`, `view_item`, plus an
  `add` command hint for agents), docs (`docs/registry.md`, a Skills card), registry pages on the
  site, and `create-efc-app` gaining `--minimal` / `--preset full` / `--add a,b`.

## Verification

- Golden-file parity with 0.7.1 (R1) across the variant matrix.
- `add` in every order: a randomized order of all items must converge to the same tree
  (catches hidden ordering dependencies between patches).
- Idempotency: running `efc add x` twice leaves no diff. A patch applied to a user-edited file
  either applies cleanly or prints its fallback, and never corrupts the file.
- Real e2e (existing `e2e.test.ts` harness) on mongo + pg-table: minimal → add auth, billing, admin
  → typecheck, boot, hit the routes.

## Out of scope for 0.8

Remote-only official registry, paid/private registry auth, UI for browsing in the studio, and
removing tables or columns on `efc remove`. `sync()` never drops anything; that stays true.
