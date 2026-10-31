# Feature matrix

What each model API does on which engine — and the test that proves it. Every test named here runs against a real database in CI; a test (`feature-matrix.test.ts`) fails if a cited test is renamed or removed, so this page can't quietly go stale.

✓ supported · — not available (by design: each native API speaks its engine's vocabulary — see [Which API?](./which-api.md))

## Models and validation

| Feature | `defineModel` MongoDB | `defineModel` PostgreSQL | `defineTable` | `defineCollection` | Proven by |
|---|:-:|:-:|:-:|:-:|---|
| Types inferred from the schema | ✓ | ✓ | ✓ | ✓ | `types/docs-types.test-d.ts: type-checked by tsc` |
| Validation on create and update → 400 | ✓ | ✓ | ✓ | ✓ | `db/engines.integration.test.ts: validates fields, embedded objects and array items` · `db/table.integration.test.ts: validates on create` · `db/collection.integration.test.ts: validates on create and on updates` |
| Unique violations → 409 | ✓ | ✓ | ✓ | ✓ | `db/engines.integration.test.ts: rejects duplicates of a unique field with 409` · `db/table.integration.test.ts: rejects duplicates with 409` |
| Defaults, `$now` / `$uuid` / sequences | ✓ | ✓ | ✓ | ✓ | `db/engines.integration.test.ts: creates records with defaults, sequences` · `db/model.smoke.test.ts: resolves $now / $uuid default operator codes` |
| Embedded objects and arrays | ✓ | ✓ (jsonb) | ✓ (jsonb) | ✓ | `db/engines.integration.test.ts: returns dates nested in objects and arrays as Date on both engines` |
| Undeclared fields ignored | ✓ | ✓ | ✓ | ✓ | `db/engines.integration.test.ts: ignores undeclared fields on writes` · `db/table.integration.test.ts: AND / OR / NOT combine, undefined is ignored, undeclared fields match nothing` |
| Engine guard (wrong engine fails clearly) | — | — | ✓ | ✓ | `db/engines.integration.test.ts: engine-native models refuse to run on the other engine` · `db/collection.integration.test.ts: rejects SQL-only types and PostgreSQL connections` |
| SQL types: integer, bigint, decimal, uuid, varchar, arrays, enums | — | — | ✓ | — | `db/table.integration.test.ts: creates SQL-native columns` · `db/table.integration.test.ts: create returns typed values` |
| BSON types: decimal128, long, binary, geoPoint | — | — | — | ✓ | `db/collection.integration.test.ts: round-trips BSON types` |

## Queries

| Feature | `defineModel` MongoDB | `defineModel` PostgreSQL | `defineTable` | `defineCollection` | Proven by |
|---|:-:|:-:|:-:|:-:|---|
| Filter operators, dotted paths, `$or`, `$exists` | ✓ | ✓ | — | ✓ | `db/engines.integration.test.ts: filters with operators, dotted paths, array containment` |
| Prisma-style `where` (incl. `mode: 'insensitive'`) | — | — | ✓ | — | `db/table.integration.test.ts: scalar filters: equals, not, in/notIn, ranges, strings, mode insensitive` |
| Sort, limit, skip, select / projection | ✓ | ✓ | ✓ | ✓ | `db/engines.integration.test.ts: supports sort, limit, skip and select` · `db/table.integration.test.ts: orderBy (multi-key, nulls), select, omit and distinct` · `db/collection.integration.test.ts: find with projection, sort, skip, limit` |
| Cursor pagination | — | — | ✓ | — | `db/table.integration.test.ts: cursor: walks every row exactly once` |
| `exists`, `distinct`, `updateOne`, `deleteOne`, `upsert` | ✓ | ✓ | ✓ | ✓ | `db/engines.integration.test.ts: upsert() creates, then updates, and survives concurrent calls` · `db/table.integration.test.ts: upsert is one INSERT … ON CONFLICT` |
| `aggregate` / `groupBy` | ✓ (pipeline) | — | ✓ | ✓ | `db/table.integration.test.ts: groupBy with aggregates, having, orderBy and take` · `db/collection.integration.test.ts: aggregate pipelines and populate` |
| Typed aggregation pipeline + `lookup()` | — | — | — | ✓ | `db/collection.integration.test.ts: typed pipeline: match (ids cast)` · `db/collection.integration.test.ts: lookup: a ref becomes its record` |
| Geo (`$near`) and `$text` | — | — | — | ✓ | `db/collection.integration.test.ts: find with projection, sort, skip, limit; geo $near; $text` |
| `bulkWrite`, change streams (`watch`) | — | — | — | ✓ | `db/collection.integration.test.ts: bulkWrite` · `db/collection.integration.test.ts: watch streams changes` |
| `findOneAndUpdate` (before / after / upsert) | — | — | — | ✓ | `db/collection.integration.test.ts: updates: results, findOneAndUpdate` |

## Relations

| Feature | `defineModel` MongoDB | `defineModel` PostgreSQL | `defineTable` | `defineCollection` | Proven by |
|---|:-:|:-:|:-:|:-:|---|
| `ref` + `populate` | ✓ | ✓ (plain column) | — | ✓ | `db/engines.integration.test.ts: populates single and array refs` |
| Real foreign keys (`onDelete` restrict / cascade / setNull) | — | — | ✓ | — | `db/table-relations.integration.test.ts: cascade deletes, setNull clears, restrict refuses with a 409` |
| Many-to-many join tables | — | — | ✓ | — | `db/table-m2n.integration.test.ts: stores the relation in a join table` |
| `include` in one SQL statement, any depth | — | — | ✓ | — | `db/table-include.integration.test.ts: nests includes with where, orderBy, take, skip — in one statement` |
| Relation filters (`some` / `every` / `none`, `is` / `isNot`) | — | — | ✓ | — | `db/table-nested.integration.test.ts: some / none / every on a hasMany back-relation` |
| Nested writes (`connect`, `create`, `connectOrCreate`, …) | — | — | ✓ | — | `db/table-nested.integration.test.ts: creates with connect, create and connectOrCreate` |

## Transactions, schema and tooling

| Feature | `defineModel` MongoDB | `defineModel` PostgreSQL | `defineTable` | `defineCollection` | Proven by |
|---|:-:|:-:|:-:|:-:|---|
| `transaction()` | ✓ (replica set) | ✓ | ✓ | ✓ (replica set) | `db/table.integration.test.ts: joins transaction() and rolls back` · `db/collection.integration.test.ts: joins transactions` |
| Auto-sync on first use (never drops data) | ✓ | ✓ | ✓ | ✓ | `db/engines.integration.test.ts: works on first use — no sync() or migration needed` · `db/engines.integration.test.ts: evolving a model never strands writes or rows` |
| `efc db generate` migrations from model diffs | ✓ | ✓ | ✓ | ✓ | `integration/db-generate.test.ts: writes a migration from the models, verifies it` · `integration/db-generate.test.ts: creates collections and indexes` |
| `efc db pull` | — | ✓ (as defineTable) | ✓ | ✓ | `integration/db-generate.test.ts: import-prisma → generate → migrate → pull round-trips` · `db/pull-mongo.integration.test.ts: the pulled models read the data and find nothing to sync` |
| `efc import-prisma` | — | — | ✓ | — | `db/prisma-import.test.ts: maps scalars, ids, timestamps, defaults` |
| Query logging + N+1 warnings | ✓ | ✓ | ✓ | ✓ | `db/query-log.integration.test.ts: warns once per request about an N+1 pattern` |
| `efc db studio --write` (through the model) | ✓ | ✓ | ✓ | ✓ | `db/studio.integration.test.ts: inserts, edits and deletes through the model` · `db/studio.integration.test.ts: writes through defineCollection` |
| Same table from `defineModel` and `defineTable` | — | ✓ | ✓ | — | `db/table.integration.test.ts: defineModel and defineTable over the same table` |

## HTTP contracts and WebSockets (since 0.11.0)

| Feature | Status | Evidence |
|---|---|---|
| OpenAPI 3.1 endpoint/offline generation, adapters, query/body contracts and optional paths | Implemented; opt-in | `openapi.test.ts: generates versioned paths, metadata, examples, JSON-schema parameters and request bodies from Zod` |
| File WS exports, middleware/auth/context, origin and payload limits, heartbeat and drain | Implemented; worker-local | `websocket.test.ts: shares real middleware, auth, decoded params and async request context, while HTTP coexists` |

No automatic auth-policy inference, message-schema validation, cross-worker broadcast bus or Swagger UI is included.

## Tracing (unreleased)

| Feature | Status | Evidence |
|---|---|---|
| HTTP W3C parentage, concurrent context isolation, template attributes and correlated logs | Opt-in; app-owned SDK | `tracing.test.ts: continues remote traces, isolates concurrent requests and records templates without URL/query/credential values` |
| Trace-only carrier handling and clean task auth scopes | Native queue hooks; unchanged payloads | `tracing.test.ts: uses native queue metadata, keeps trace-only carriers, and clears auth/request state for task handlers` |
