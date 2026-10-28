# defineCollection — API Reference

`defineCollection` is the MongoDB-native model API. It uses mongoose's vocabulary (`find` with projections, `findOneAndUpdate`, `bulkWrite`, aggregation pipelines, change streams) and adds BSON types. It runs on the same foundation as `defineModel`: schema format, inferred types, validation, auto-sync, `transaction()`, `efc db generate`. Underneath, it is a mongoose model.

Building on PostgreSQL? Use [`defineTable`](./table.md). Need one model for both engines? Use [`defineModel`](./db.md). See [Which model API?](../guides/which-api.md).

```ts
import { defineCollection, type InferRecord } from 'express-file-cluster';

export const Place = defineCollection('Place', {
  name:     { type: 'string', required: true },
  location: { type: 'geoPoint', index: '2dsphere' },
  price:    { type: 'decimal128' },                      // '19.99', exact
  visits:   { type: 'long', default: 0 },                // bigint
  tags:     { type: 'array', of: 'string', default: [] },
  owner:    { type: 'objectId', ref: 'User' },
  reviews:  [{ rating: { type: 'number', required: true, min: 1, max: 5 }, text: { type: 'string' } }],
}, { indexes: [{ fields: { name: 'text' } }] });

export type Place = InferRecord<typeof Place>;

const near = await Place.find(
  { location: { $near: { $geometry: { type: 'Point', coordinates: [85.32, 27.71] }, $maxDistance: 2000 } } },
  { projection: { name: 1 }, limit: 10 },
);
await Place.findOneAndUpdate({ name }, { $inc: { visits: 1 } }, { upsert: true, returnDocument: 'after' });
```

Using a `defineCollection` model on a PostgreSQL connection fails at its first query, with an `[EFC]` error naming the model.

---

## Field types

Every `defineModel` field type and option works (`string`, `number`, `boolean`, `date`, `objectId`, embedded objects and arrays, `required`, `default`, `enum`, `min`/`max`, `match`, `validate`, `ref`, `sequence`, `renamedFrom`). On top of them:

| Type | Stored as | In records |
|---|---|---|
| `decimal128` | `Decimal128` | `string` (exact, `'19.99'`); writes take strings or numbers |
| `long` | `Long` (int64) | `bigint`, whatever the size; writes take bigints or numbers |
| `geoPoint` | GeoJSON `{ type: 'Point', coordinates: [lng, lat] }` | `GeoPoint`; longitude first, both checked for range |
| `binary` | `Binary` | `Buffer` |

The PostgreSQL types (`integer`, `bigint`, `decimal`, `uuid`, `json`) and `defineTable` options are refused at definition, with an `[EFC]` error naming the field.

`index` takes `true`, or a special index: `'2dsphere'` (geo), `'text'` or `'hashed'`. In `options.indexes`, field values can also be `'2dsphere'` and `'hashed'`, and an index can be partial:

```ts
{ indexes: [
  { fields: { name: 'text', description: 'text' } },
  { fields: { email: 1 }, unique: true, partialFilterExpression: { deletedAt: { $exists: false } } },
  { fields: { expiresAt: 1 }, expireAfterSeconds: 0 },          // TTL
] }
```

## Options

`ModelOptions` (`timestamps`, `indexes`, `collection`) plus:

| Option | |
|---|---|
| `collation` | default collation for queries and aggregations, e.g. `{ locale: 'en', strength: 2 }` (case-insensitive) |

---

## Reading

```ts
find(filter?, options?): Promise<Record[]>
findOne(filter?, options?): Promise<Record | null>
findById(id, options?): Promise<Record | null>              // malformed id → null
exists(filter): Promise<boolean>
countDocuments(filter?): Promise<number>
estimatedDocumentCount(): Promise<number>                   // from metadata: fast, no filter
distinct(field, filter?): Promise<value[]>                  // arrays are unwound, as in MongoDB
```

| `options` | |
|---|---|
| `projection` | `{ name: 1 }` (only these, plus `id`) or `{ secret: 0 }` (all but these) |
| `sort` | `{ createdAt: -1, name: 'asc' }`, or `{ score: { $meta: 'textScore' } }` |
| `skip`, `limit` | |
| `populate` | `ref` fields to replace with the referenced documents |
| `collation` | overrides the model's |

Filters are MongoDB query documents: every query operator works (`$near`, `$geoWithin`, `$text`, `$elemMatch`, `$regex`, `$expr`, …), as do dotted paths. `id` is accepted for `_id`. Field values are type-checked against the record; dotted paths and operators are not.

## Writing

```ts
create(data): Promise<Record>
insertMany(data[]): Promise<Record[]>
updateOne(filter, update, { upsert? }): Promise<WriteResult>
updateMany(filter, update, { upsert? }): Promise<WriteResult>
replaceOne(filter, replacement, { upsert? }): Promise<WriteResult>
findOneAndUpdate(filter, update, { upsert?, returnDocument?, projection?, sort? }): Promise<Record | null>
findByIdAndUpdate(id, update, { returnDocument? }): Promise<Record | null>
findOneAndDelete(filter, { sort? }): Promise<Record | null>
findByIdAndDelete(id): Promise<Record | null>
deleteOne(filter): Promise<{ deletedCount }>
deleteMany(filter?): Promise<{ deletedCount }>
bulkWrite(ops, { ordered? }): Promise<BulkResult>
```

- `WriteResult` is `{ matchedCount, modifiedCount, upsertedCount, upsertedId }`.
- As in mongoose, `findOneAndUpdate` returns the document **before** the update unless you pass `returnDocument: 'after'`.
- Updates take plain fields (shorthand for `$set`) or any update operator (`$set $unset $inc $mul $min $max $push $pull $addToSet $pop $rename $setOnInsert $currentDate`).
- **Writes are validated**: creates against the whole schema, updates on the fields they change (`runValidators`). Failures throw `ModelValidationError` (400 with `issues`). A duplicate on a unique index is an `HttpError` 409.
- `bulkWrite` takes `insertOne`, `updateOne`, `updateMany`, `replaceOne`, `deleteOne` and `deleteMany` operations, and returns `{ insertedCount, matchedCount, modifiedCount, deletedCount, upsertedCount }`.

```ts
await Place.bulkWrite([
  { insertOne: { document: { name: 'Patan' } } },
  { updateOne: { filter: { name: 'Boudha' }, update: { $addToSet: { tags: 'stupa' } }, upsert: true } },
  { deleteMany: { filter: { visits: { $lt: 1 } } } },
]);
```

## Aggregation

### Typed pipelines

`pipeline()` builds an aggregation stage by stage, and each stage's output type is inferred from the schema — no hand-written result types:

```ts
const ratings = await Place.pipeline()
  .match({ owner: ownerId })                 // string ids are cast, like find()
  .unwind('$reviews')                        // reviews: { rating, text } (one per result)
  .group({ _id: '$name', avg: { $avg: '$reviews.rating' }, n: { $sum: 1 } })
  .sort({ avg: -1 });
// ratings: { _id: string; id: string; avg: number | null; n: number }[]
```

| Stage | Output type |
|---|---|
| `match(filter)`, `sort`, `skip`, `limit`, `sample(n)` | unchanged |
| `unwind('$field', { preserveNullAndEmptyArrays? })` | the array field holds one element (or `null` when preserved) |
| `group({ _id, …accumulators })` | `_id` (a `'$field'`, `null` or `{ key: '$field' }`), a string `id`, and per accumulator: `$sum`/`$count` → `number` (`$sum` of a `decimal128` → exact `string`), `$avg` → `number \| null`, `$min`/`$max`/`$first`/`$last` → the field's type, `$push`/`$addToSet` → an array of it |
| `project({ a: 1, b: 1 })` | only those fields, plus `id` |
| `count('n')` | `{ n: number }` (no result when nothing matched) |
| `lookup('ref', Model)` / `lookup({ from, localField, foreignField, as })` | see below |
| `addFields<{ x: number }>({ … })` | adds the fields you name in the generic |
| `stage<Out>({ … })` | anything else (`$facet`, `$bucket`, …), with its output type spelled out |

Field references (`'$name'`, `'$address.city'`) are checked against the record — one level into embedded objects. Await the builder, or call `.exec()`; `.toArray()` returns the stages as plain objects.

While the records still have the collection's shape, `match` and `sort` are cast like `find()` (`id` → `_id`, string ids → ObjectIds). After a stage that changes the shape (`group`, `unwind`, `lookup`, `project`, …) they're passed through as written.

### `lookup()`

```ts
const posts = await Post.lookup('author', User, { published: true });
// posts[0].author: User record | null    (an array of refs → User records[])

const users = await User.pipeline()
  .lookup({ from: Post, localField: 'id', foreignField: 'author', as: 'posts' });
// users[0].posts: Post records[]
```

The first form replaces a `ref` field with the record it points to (`null` when it points nowhere); the optional third argument filters first. Inside a pipeline it's `.lookup('author', User)`. The full form adds an array field; `id` means `_id` on either side. The target is a model, so the collection name is never spelled out.

### Raw pipelines

```ts
const ratings = await Place.aggregate<{ _id: string; avg: number }>([
  { $unwind: '$reviews' },
  { $group: { _id: '$name', avg: { $avg: '$reviews.rating' } } },
  { $sort: { avg: -1 } },
]);
```

`aggregate()` passes the pipeline to MongoDB unchanged (no id casting); type the output with the generic. Results of both forms get the same conversions as records: decimals become strings, longs bigints, `_id` gains a string `id`.

## Change streams

```ts
const stream = Place.watch([{ $match: { operationType: 'insert' } }]);
for await (const change of stream) {
  console.log(change.operationType, change.id, change.fullDocument?.name);
  if (done) break;                    // or: await stream.close()
}
```

Each change has `operationType`, `id` (the document's), `fullDocument` (inserts and replaces; updates with `{ fullDocument: 'updateLookup' }`), `updateDescription` and `raw` (the driver's event). Change streams need a replica set.

## Transactions

Calls inside `transaction(async () => { … })` join it, as with `defineModel`. MongoDB transactions need a replica set.

## Sync and migrations

The same as `defineModel` on MongoDB. On first use the collection and its indexes are created (`autoSync`). `efc db sync [--dry-run]` reconciles indexes, and `efc db generate` writes migrations for index changes and `renamedFrom` fields.

## Also

- `raw()`: the mongoose `Model`, for anything not covered here.
- `sync({ dryRun? })`, `drop()`.
- Types: `InferRecord<typeof Place>`, `InferCreate<typeof Place>`, `CollectionFilter<R>`, `CollectionUpdate<R>`.
