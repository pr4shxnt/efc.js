/* eslint-disable @typescript-eslint/no-unused-vars -- models are only inspected via `typeof` */
// The examples in docs/api-reference/types.md, checked by `tsc` (npm run typecheck).
import { expectTypeOf } from 'vitest';
import { defineTable, defineCollection, defineModel } from '../../index.js';
import type { InferCreate, InferRecord } from '../../index.js';

const Order = defineTable('DocsOrder', {
  number: { type: 'string', required: true, unique: true },
  status: { type: 'string', enum: ['open', 'paid'], default: 'open' },
  total: { type: 'decimal', precision: 10, scale: 2, required: true },
  lines: [{ sku: { type: 'string', required: true }, qty: { type: 'integer' } }],
  paidAt: { type: 'date' },
});

expectTypeOf<InferRecord<typeof Order>>().toEqualTypeOf<{
  id: string;
  number: string;
  status: 'open' | 'paid';
  total: string;
  lines?: { sku: string; qty?: number }[];
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}>();
type NewOrder = InferCreate<typeof Order>;
expectTypeOf<NewOrder['number']>().toEqualTypeOf<string>();
expectTypeOf<NewOrder['total']>().toEqualTypeOf<string | number>();
expectTypeOf<NewOrder['status']>().toEqualTypeOf<'open' | 'paid' | undefined>();
expectTypeOf<NewOrder['paidAt']>().toEqualTypeOf<Date | string | number | undefined>();

// Ids per API / options.
const Serial = defineTable('DocsSerial', { a: { type: 'string' } }, { id: 'serial' });
expectTypeOf<InferRecord<typeof Serial>['id']>().toEqualTypeOf<number>();
const Coll = defineCollection('DocsColl', {
  price: { type: 'decimal128' },
  hits: { type: 'long', required: true },
  at: { type: 'geoPoint' },
});
expectTypeOf<InferRecord<typeof Coll>['id']>().toEqualTypeOf<string>();
expectTypeOf<InferRecord<typeof Coll>['hits']>().toEqualTypeOf<bigint>();
expectTypeOf<InferCreate<typeof Coll>['hits']>().toEqualTypeOf<bigint | number>();
expectTypeOf<NonNullable<InferRecord<typeof Coll>['price']>>().toEqualTypeOf<string>();

// Types that belong to the other API don't compile.
// @ts-expect-error — integer is defineTable-only
defineCollection('DocsBad1', { n: { type: 'integer' } });
// @ts-expect-error — decimal128 is defineCollection-only
defineTable('DocsBad2', { n: { type: 'decimal128' } });

// Timestamps renamed / dropped.
const Renamed = defineModel('DocsRenamed', { a: { type: 'string' } }, {
  timestamps: { createdAt: 'created_at', updatedAt: false },
});
expectTypeOf<InferRecord<typeof Renamed>>().toEqualTypeOf<{ id: string; a?: string; created_at: Date }>();
