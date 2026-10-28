# Type inference

EFC models are typed from their schema literal — there's no interface to write or keep in step. All three model APIs (`defineModel`, `defineTable`, `defineCollection`) share the rules below; each also types its own queries.

```ts
import { defineTable, type InferRecord, type InferCreate } from 'express-file-cluster';

export const Order = defineTable('Order', {
  number: { type: 'string', required: true, unique: true },
  status: { type: 'string', enum: ['open', 'paid'], default: 'open' },
  total:  { type: 'decimal', precision: 10, scale: 2, required: true },
  lines:  [{ sku: { type: 'string', required: true }, qty: { type: 'integer' } }],
  paidAt: { type: 'date' },
});

type OrderRecord = InferRecord<typeof Order>;
// { id: string; number: string; status: 'open' | 'paid'; total: string;
//   lines?: { sku: string; qty?: number }[]; paidAt?: Date; createdAt: Date; updatedAt: Date }

type NewOrder = InferCreate<typeof Order>;
// { number: string; total: string | number; status?: 'open' | 'paid'; lines?: …; paidAt?: Date | string | number }
```

| Helper | Gives you |
|---|---|
| `InferRecord<typeof M>` | What reads return: every stored field, `id`, timestamps |
| `InferCreate<typeof M>` | What `create()` accepts |
| `InferTableRecord<typeof M>` | Same as `InferRecord`, for `defineTable` models (kept for older code) |

## Field types

| Schema `type` | Record type | `create()` / update input | `defineModel` | `defineTable` | `defineCollection` |
|---|---|---|:-:|:-:|:-:|
| `'string'` | `string` | `string` | ✓ | ✓ | ✓ |
| `'number'` | `number` | `number` | ✓ | ✓ | ✓ |
| `'boolean'` | `boolean` | `boolean` | ✓ | ✓ | ✓ |
| `'date'` | `Date` | `Date \| string \| number` | ✓ | ✓ | ✓ |
| `'objectId'` | `string` | `string` | ✓ | ✓ | ✓ |
| `'integer'` | `number` (whole, 32-bit) | `number` | | ✓ | |
| `'bigint'` | `bigint` | `bigint \| number` | | ✓ | |
| `'decimal'` | `string` (exact) | `string \| number` | | ✓ | |
| `'uuid'` | `string` | `string` | | ✓ | |
| `'json'` | `unknown` | `unknown` | | ✓ | |
| `'decimal128'` | `string` (exact) | `string \| number` | | | ✓ |
| `'long'` | `bigint` | `bigint \| number` | | | ✓ |
| `'geoPoint'` | `{ type: 'Point'; coordinates: [number, number] }` | same | | | ✓ |
| `'binary'` | `Buffer` | `Buffer` | | | ✓ |
| `enum: [...]` | union of the literals | same | ✓ | ✓ | ✓ |
| `{ type: 'array', of: X }` | `X[]` | `X[]` (input form of `X`) | ✓ | ✓ | ✓ |
| `[{ …schema }]` / `of: { …schema }` | array of the inferred object | same | ✓ | ✓ | ✓ |
| nested schema / `{ type: 'object', fields }` | the inferred object | same, with create rules | ✓ | ✓ | ✓ |
| `{ type: 'object' }` without `fields`, `{ type: 'array' }` without `of` | `unknown` / `unknown[]` | same | ✓ | ✓ | ✓ |

A type that isn't valid for the API (`'decimal128'` in `defineTable`, `'integer'` in `defineCollection`) is a compile error, and throws at definition time in JavaScript.

## Optional or not

| The field has | Record | `create()` input |
|---|---|---|
| `required: true` | present | mandatory |
| `required: true` + `default` (or `sequence`) | present | optional |
| `default` or `sequence` only | present | optional |
| none of these | optional (`?`) | optional |

The rules apply inside embedded objects too; an embedded object's inner `required` fields only apply when the object is there.

## Ids and timestamps

| | `id` |
|---|---|
| `defineModel`, `defineCollection` | `string` |
| `defineTable` | `string` (uuid, default) · `number` with `{ id: 'serial' }` · `bigint` with `{ id: 'bigserial' }` |

`createdAt` / `updatedAt: Date` are added unless `options.timestamps` is `false`; `{ createdAt: 'created_at', updatedAt: false }` renames or drops one, and the type follows.

## Typed queries

- **Filters, updates, sorts and `distinct()`** take the record's fields only; an undeclared field or a value outside an `enum` is a compile error.
- **`defineTable` `select` / `omit`** narrow the result type to those fields. **`include`** types the related records once the models are registered:

  ```ts
  declare module 'express-file-cluster' {
    interface Tables { User: typeof User; Post: typeof Post }
  }
  ```

  Apps from `create-efc-app` (and `efc db pull`) write this in `src/model/index.ts`. See [`defineTable` relations](./table.md).
- **`defineCollection` `pipeline()`** types every stage's output — `group` accumulators, `unwind`, `lookup`, `project`, `count` — and `lookup('ref', Model)` replaces a ref with the referenced record type. See [typed pipelines](./collection.md#typed-pipelines).

## When there's nothing to infer from

A schema stored in a variable annotated with the wide type has lost its literal:

```ts
const schema: ModelSchema = { title: { type: 'string' } }; // ✗ InferRecord is a loose object
const schema = { title: { type: 'string' } } as const satisfies ModelSchema; // ✓
```

Declare it inline (or `as const satisfies …`). `defineModel<T>('Name', schema)` with an explicit interface still works and keeps the v0.4 behaviour (`create()` takes `Partial<T>`).
