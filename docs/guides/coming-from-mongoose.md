# Coming from mongoose

`defineCollection` keeps mongoose's query language, with the schema as a plain object, types inferred from it, and validation errors that become HTTP responses. Underneath it is still mongoose, so your data and indexes stay as they are.

---

## 1. Schemas

```ts
// mongoose
const PlaceSchema = new Schema({
  name: { type: String, required: true },
  price: Schema.Types.Decimal128,
  location: { type: { type: String, enum: ['Point'] }, coordinates: [Number] },
  owner: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
PlaceSchema.index({ location: '2dsphere' });
export const Place = model('Place', PlaceSchema);

// EFC
export const Place = defineCollection('Place', {
  name:     { type: 'string', required: true },
  price:    { type: 'decimal128' },
  location: { type: 'geoPoint', index: '2dsphere' },
  owner:    { type: 'objectId', ref: 'User' },
});
export type Place = InferRecord<typeof Place>;   // no interface to keep in step
```

| mongoose | EFC |
|---|---|
| `String`, `Number`, `Boolean`, `Date`, `ObjectId` | `'string'`, `'number'`, `'boolean'`, `'date'`, `'objectId'` |
| `Decimal128`, `BigInt`, `Buffer` | `'decimal128'` (string), `'long'` (bigint), `'binary'` (Buffer) |
| GeoJSON point sub-schema | `'geoPoint'` |
| `[String]`, `[SubSchema]` | `{ type: 'array', of: 'string' }`, `[{ … }]` |
| `required`, `default`, `enum`, `min`, `max`, `minlength`, `match`, `validate` | same names (`minLength`, `maxLength`) |
| `timestamps: true` | the default |
| `schema.index({...})` | `index:` on the field, or `options.indexes` |

## 2. Queries

| mongoose | EFC |
|---|---|
| `Model.find(filter).select('name').sort('-createdAt').limit(10).lean()` | `Place.find(filter, { projection: { name: 1 }, sort: { createdAt: -1 }, limit: 10 })` |
| `.populate('owner')` | `{ populate: 'owner' }` |
| `findOne`, `findById`, `countDocuments`, `distinct`, `exists` | same names |
| `create`, `insertMany`, `updateOne`, `updateMany`, `replaceOne`, `deleteOne`, `deleteMany` | same names and result counts |
| `findOneAndUpdate(f, u, { new: true, upsert: true })` | `findOneAndUpdate(f, u, { returnDocument: 'after', upsert: true })` |
| `aggregate([...])`, `bulkWrite([...])`, `watch([...])` | same |
| `session` passed to every call | `transaction(async () => { … })` and calls inside join it |

Records are plain objects (like `lean()`) with a string `id`. Decimals come back as strings and longs as bigints.

## 3. What you gain

- Validation errors become a **400** with `issues`, and duplicate keys a **409**, with no error-handling code.
- Collections and indexes are created on first use (`autoSync`), and `efc db generate` writes index migrations.
- Need one model for MongoDB and PostgreSQL? Use [`defineModel`](../api-reference/db.md) instead. See [Which model API?](./which-api.md).

Full reference: [`defineCollection`](../api-reference/collection.md).
