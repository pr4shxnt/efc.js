// Type-level tests for defineCollection's typed pipeline and lookup(). Checked by `tsc`
// (npm run typecheck); every `@ts-expect-error` marks a call that must NOT compile.
import { expectTypeOf } from 'vitest';
import { defineCollection } from '../../index.js';
import type { InferRecord } from '../../index.js';

const Author = defineCollection('PAuthor', {
  name: { type: 'string', required: true },
});
type AuthorRecord = InferRecord<typeof Author>;

const Sale = defineCollection('PSale', {
  region: { type: 'string', required: true },
  qty: { type: 'number', required: true },
  price: { type: 'decimal128', required: true },
  tags: { type: 'array', of: 'string', default: [] },
  seller: { type: 'objectId', ref: 'PAuthor' },
  editors: { type: 'array', of: 'objectId', ref: 'PAuthor', default: [] },
  lines: [{ sku: { type: 'string', required: true }, n: { type: 'number', required: true } }],
});
type SaleRecord = InferRecord<typeof Sale>;

// Stages that keep the shape.
const kept = Sale.pipeline().match({ region: 'eu' }).sort({ qty: -1 }).skip(1).limit(5);
expectTypeOf(kept.exec()).resolves.toEqualTypeOf<SaleRecord[]>();

// $group: the key's type and each accumulator's result.
const byRegion = Sale.pipeline().group({
  _id: '$region',
  units: { $sum: '$qty' },
  orders: { $sum: 1 },
  revenue: { $sum: '$price' }, // decimal128 → exact string
  avgQty: { $avg: '$qty' },
  largest: { $max: '$qty' },
  skus: { $addToSet: '$region' },
});
expectTypeOf(byRegion.exec()).resolves.toEqualTypeOf<
  {
    _id: string;
    id: string;
    units: number;
    orders: number;
    revenue: string;
    avgQty: number | null;
    largest: number;
    skus: string[];
  }[]
>();
// A compound key.
const compound = Sale.pipeline().group({ _id: { r: '$region', q: '$qty' }, n: { $sum: 1 } });
expectTypeOf(compound.exec()).resolves.toEqualTypeOf<{ _id: { r: string; q: number }; id: string; n: number }[]>();
// @ts-expect-error — not a field of Sale
Sale.pipeline().group({ _id: '$nope', n: { $sum: 1 } });
// @ts-expect-error — not an accumulator
Sale.pipeline().group({ _id: null, n: { $median: '$qty' } });

// $unwind: the array field holds one element.
const lines = Sale.pipeline().unwind('$lines');
type Flat<T> = { [K in keyof T]: T[K] } & {};
expectTypeOf(lines.exec()).resolves.toEqualTypeOf<
  Flat<Omit<SaleRecord, 'lines'> & { lines: { sku: string; n: number } }>[]
>();
// …and feeds the next stage.
const perSku = Sale.pipeline().unwind('$lines').group({ _id: '$region', n: { $sum: 1 } });
expectTypeOf(perSku.exec()).resolves.toEqualTypeOf<{ _id: string; id: string; n: number }[]>();
// Nested paths after an unwind.
const bySku = Sale.pipeline().unwind('$lines').group({ _id: '$lines.sku', n: { $sum: '$lines.n' } });
expectTypeOf(bySku.exec()).resolves.toEqualTypeOf<{ _id: string; id: string; n: number }[]>();
// @ts-expect-error — no such embedded field
Sale.pipeline().unwind('$lines').group({ _id: '$lines.nope', n: { $sum: 1 } });
// @ts-expect-error — region isn't an array
Sale.pipeline().unwind('$region');

// $project (inclusion) and $count.
expectTypeOf(Sale.pipeline().project({ region: 1, qty: 1 }).exec()).resolves.toEqualTypeOf<
  { region: string; qty: number; id: string }[]
>();
expectTypeOf(Sale.pipeline().match({ qty: { $gt: 1 } }).count('n').exec()).resolves.toEqualTypeOf<
  { n: number }[]
>();

// lookup(): a single ref becomes the record or null; an array of refs, records.
const withSeller = await Sale.lookup('seller', Author);
expectTypeOf(withSeller[0]!.seller).toEqualTypeOf<AuthorRecord | null>();
const withEditors = await Sale.pipeline().lookup('editors', Author);
expectTypeOf(withEditors[0]!.editors).toEqualTypeOf<AuthorRecord[]>();
// The full form adds a field.
const reverse = await Author.pipeline().lookup({
  from: Sale,
  localField: 'id',
  foreignField: 'seller',
  as: 'sales',
});
expectTypeOf(reverse[0]!.sales).toEqualTypeOf<SaleRecord[]>();
// Awaiting the builder works like exec().
const awaited = await Sale.pipeline().count('n');
expectTypeOf(awaited).toEqualTypeOf<{ n: number }[]>();

// sort() takes the current stage's fields.
Sale.pipeline().group({ _id: '$region', n: { $sum: 1 } }).sort({ n: -1 });
Sale.pipeline().sort({ id: 1, region: 'asc' });
