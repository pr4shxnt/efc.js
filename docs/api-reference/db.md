# Database — API Reference

EFC provides two levels of database access, both from `express-file-cluster`:

```ts
import { defineModel, db } from 'express-file-cluster';
```

---

## `defineModel(name, schema, options?)`

Creates an engine-agnostic model with a unified CRUD surface. Designed to work against MongoDB (via `mongoose`, implemented today) or PostgreSQL (via Drizzle, planned — see below).

```ts
function defineModel<T extends Record<string, any>>(
  name: string,
  schema: ModelSchema,
  options?: ModelOptions,
): ModelCRUD<T>
```

| Parameter | Type | Description |
|---|---|---|
| `name` | `string` | Model name (used as the Mongoose model name / SQL table name) |
| `schema` | `ModelSchema` | Field definitions — see below |
| `options` | `ModelOptions` | Model-level options — see [Model options](#modeloptions) below |

### `ModelSchema`

```ts
type PrimitiveFieldType = 'string' | 'number' | 'boolean' | 'date' | 'object' | 'objectId';

interface FieldDefinition {
  type: PrimitiveFieldType | 'array';
  required?: boolean;
  unique?: boolean;
  default?: unknown;
  enum?: readonly (string | number)[];  // valid on 'string'/'number' types
  ref?: string;                         // Mongoose model name; valid on 'objectId' types
  of?: PrimitiveFieldType;              // item type for 'array' fields
  sequence?: boolean | string;          // auto-increment — see "Sequence fields" below
}

// A field is either a FieldDefinition, or a one-element tuple holding a nested ModelSchema —
// the latter defines an array of embedded sub-documents (see "Nested array schemas" below).
type ModelSchema = Record<string, FieldDefinition | [ModelSchema]>;
```

### Example

```ts
// src/model/User.ts
import { defineModel } from 'express-file-cluster';

interface User {
  name: string;
  email: string;
  role: string;
}

export const User = defineModel<User>('User', {
  name:  { type: 'string', required: true },
  email: { type: 'string', required: true, unique: true },
  role:  { type: 'string', enum: ['member', 'admin'], default: 'member' },
});
```

### Default value operator codes

Besides literal values, `default` accepts sentinel strings that are resolved to a generator function at schema-compile time — each document gets a freshly-computed value, not one baked in at schema-definition time:

| Code | Resolves to | Pair with |
|---|---|---|
| `'$now'` | `new Date()`, evaluated per document | `type: 'date'` |
| `'$uuid'` | `crypto.randomUUID()`, evaluated per document | `type: 'string'` |
| `'$objectId'` | a fresh Mongoose `ObjectId`, evaluated per document | `type: 'objectId'` |
| `'$timestamp'` | current epoch milliseconds (`Date.now()`, a `number`), evaluated per document | `type: 'number'` |
| `'$shortId'` | a random 16-character base64url string, evaluated per document | `type: 'string'` |
| `'$currentUser'` | the JWT payload [`requireAuth`](./auth.md) attached to the in-flight request (via [`getCurrentUser()`](./auth.md#getcurrentuser)) | `type: 'object'` |
| `'$currentUser.<key>'` | a single field plucked from that payload, e.g. `'$currentUser.id'` | matches that field's shape |

```ts
export const Session = defineModel<Session>('Session', {
  token:     { type: 'string', default: '$uuid' },
  apiKey:    { type: 'string', default: '$shortId' },
  ownerId:   { type: 'objectId', default: '$objectId' },
  createdAt: { type: 'date',   default: '$now' },
  createdAtMs: { type: 'number', default: '$timestamp' },
});

export const Post = defineModel<Post>('Post', {
  title:     { type: 'string', required: true },
  createdBy: { type: 'string', default: '$currentUser.id' }, // e.g. the JWT's `id` claim
});
```

`'$currentUser'` and `'$currentUser.<key>'` resolve to `undefined` outside a request, or on a route that never ran through `requireAuth` — they don't throw. The value is read live from the same `AsyncLocalStorage` context `getCurrentUser()` uses, so it reflects whatever payload the request's `requireAuth` middleware verified, not a snapshot taken at schema-definition time.

Any other string (or value) passed to `default` is used as-is, unchanged — only these exact strings/prefixes are special-cased.

### Sequence fields (auto-increment)

`'$increment'` is **not** a `default` code — `default` is resolved synchronously by mongoose, but an auto-increment needs an async read-modify-write against a counters collection. Instead, use the `sequence` field option:

```ts
interface FieldDefinition {
  // ...
  sequence?: boolean | string;
}
```

```ts
export const Order = defineModel<Order>('Order', {
  orderNumber: { type: 'number', sequence: true, required: true },
});
```

- `sequence: true` uses `'<ModelName>.<field>'` as the counter key.
- `sequence: 'some-key'` uses an explicit key, letting multiple fields (even across different models) share one counter — useful for a single global document number.
- The value is assigned in a `pre('validate')` hook (before `required` is checked, so `sequence` fields can also be `required: true`), only on new documents, and only when the field wasn't already set explicitly (so passing your own value on `create()` still wins).
- The counter itself lives in an internal `efc_counters` collection and is incremented atomically (`$inc` + upsert), so it's safe under concurrent inserts across workers/processes.
- Only supported on top-level fields — not inside nested array sub-schemas.

### `ModelOptions`

```ts
interface ModelOptions {
  timestamps?: boolean | { createdAt?: string | false; updatedAt?: string | false };
}
```

Passed straight through to mongoose's own `timestamps` schema option. Default is `true` (adds `createdAt`/`updatedAt`), matching EFC's previous hardcoded behavior — pass `false` to disable both, or an object to rename/selectively disable one:

```ts
export const Log = defineModel<Log>(
  'Log',
  { message: { type: 'string', required: true } },
  { timestamps: false },
);

export const Event = defineModel<Event>(
  'Event',
  { name: { type: 'string', required: true } },
  { timestamps: { createdAt: 'created_at', updatedAt: false } },
);
```

### `objectId` references

```ts
export const Trip = defineModel<Trip>('Trip', {
  visiting_place_id: { type: 'objectId', ref: 'VisitingPlace', required: true },
  tags:              { type: 'array', of: 'string' },
  waypoint_ids:      { type: 'array', of: 'objectId', ref: 'Waypoint' },
});
```

`type: 'objectId'` validates the field is cast to a Mongo `ObjectId` (invalid strings raise a cast error before saving) and `ref` records which model it points to, enabling `.populate()` via the `populate` query option (see below).

### Nested array schemas

An array of embedded sub-documents is written as a one-element array literal in place of a `FieldDefinition`:

```ts
export const Trip = defineModel<Trip>('Trip', {
  route_progress: [
    {
      route_id:    { type: 'string', required: true },
      route_index: { type: 'number', required: true },
      visited:     { type: 'boolean', required: true },
    },
  ],
});
```

---

## `ModelCRUD<T>` — returned interface

Every model exposes these async methods:

### `find(filter?, options?)`

```ts
interface ModelQueryOptions {
  populate?: string | string[]; // Mongoose .populate() path(s) for objectId/ref fields
}

find(filter?: Partial<T>, options?: ModelQueryOptions): Promise<(T & { id: string })[]>
```

Returns all records matching the filter. Pass no arguments to return all records.

```ts
const users = await User.find();
const admins = await User.find({ role: 'admin' });
const trips = await Trip.find({}, { populate: 'visiting_place_id' });
```

---

### `findById(id, options?)`

```ts
findById(id: string, options?: ModelQueryOptions): Promise<(T & { id: string }) | null>
```

Finds a single record by its primary key. Returns `null` if not found. The `id` string is cast to the engine's native PK type (`ObjectId` for MongoDB).

```ts
const user = await User.findById(req.params.id);
if (!user) throw new HttpError(404, 'User not found');
```

---

### `findOne(filter, options?)`

```ts
findOne(filter: Partial<T>, options?: ModelQueryOptions): Promise<(T & { id: string }) | null>
```

Finds the first record matching the filter. Returns `null` if not found.

```ts
const user = await User.findOne({ email: 'alice@example.com' });
```

---

### `create(data)`

```ts
create(data: Partial<T>): Promise<T & { id: string }>
```

Creates a new record. Returns the created record with its generated `id`.

```ts
const user = await User.create({ name: 'Alice', email: 'alice@example.com' });
res.status(201).json({ id: user.id });
```

---

### `update(id, data)`

```ts
update(id: string, data: Partial<T>): Promise<(T & { id: string }) | null>
```

Updates a record by id. Returns the updated record, or `null` if not found.

```ts
const user = await User.update(req.params.id, { role: 'admin' });
```

---

### `delete(id)`

```ts
delete(id: string): Promise<void>
```

Deletes a record by id. Does not throw if the record does not exist.

```ts
await User.delete(req.params.id);
res.status(204).send();
```

---

### `count(filter?)`

```ts
count(filter?: Partial<T>): Promise<number>
```

Returns the number of records matching the filter.

```ts
const total = await User.count();
const admins = await User.count({ role: 'admin' });
```

---

## Normalised `id` field

Every record returned by `defineModel` methods has a string `id` field:

- **MongoDB** — mapped from Mongoose's `_id` (`ObjectId.toString()`).
- **PostgreSQL** — mapped from the SQL primary key.

Route handler code never needs to branch on engine type to read the record's identifier.

---

## `db` — raw client (escape hatch)

`db` is a thread-local proxy that resolves to the native database client bootstrapped during Pre-Flight. Use it when `defineModel` doesn't cover an engine-specific feature.

```ts
import { db } from 'express-file-cluster';
```

The type of `db` at runtime:

| `config.database` | `db` type |
|---|---|
| `'mongodb'` | `mongoose.Connection` |
| `'postgresql'` | `pg.Pool` _(planned)_ |

### MongoDB example

```ts
import { db } from 'express-file-cluster';

export const GET = async (req, res) => {
  // Aggregation pipeline — not available through defineModel
  const results = await db.model('User').aggregate([
    { $match: { role: 'admin' } },
    { $group: { _id: '$role', count: { $sum: 1 } } },
  ]);
  res.json(results);
};
```

### Safety

`db` is a JavaScript `Proxy`. Accessing any property before Pre-Flight completes (i.e. before `ignite()` has run) throws:

```
Error: [EFC] db not ready — accessed before Pre-Flight completed
```

In practice, route handlers and task handlers always run after Pre-Flight, so this error only appears in test code that constructs handlers manually without calling `ignite()`.

---

## `getDbClient()` / `setDbClient()`

Low-level functions used internally by EFC. You generally don't need these unless you're writing a custom database adapter.

```ts
import { getDbClient, setDbClient } from 'express-file-cluster';

setDbClient(myNativeConnection);    // called by EFC during Pre-Flight
const client = getDbClient();       // returns the stored client, throws if not set
```
