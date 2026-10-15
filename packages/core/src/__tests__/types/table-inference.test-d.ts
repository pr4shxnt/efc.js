/* eslint-disable @typescript-eslint/no-unused-vars -- models are only inspected via `typeof` */
// Type-level tests for defineTable. Checked by `tsc` (npm run typecheck); every
// `@ts-expect-error` marks a call that must NOT compile.
import { expectTypeOf } from 'vitest';
import { defineModel, defineTable } from '../../index.js';
import type { InferCreate, InferRecord, InferTableRecord } from '../../index.js';

const Order = defineTable(
  'Order',
  {
    number: { type: 'string', required: true, unique: true, maxLength: 20 },
    status: { type: 'string', enum: ['open', 'paid'], default: 'open', nativeEnum: true },
    total: { type: 'decimal', precision: 10, scale: 2, required: true },
    qty: { type: 'integer', required: true },
    views: { type: 'bigint', default: 0n },
    ref: { type: 'uuid' },
    tags: { type: 'array', of: 'string', default: [] },
    lines: [{ sku: { type: 'string', required: true } }],
    meta: { type: 'json' },
    customer: { type: 'string', required: true },
    shippedAt: { type: 'date' },
  },
  { id: 'serial', indexes: [{ fields: { customer: 1, qty: 1 }, unique: true }] },
);

type OrderRecord = InferRecord<typeof Order>;
expectTypeOf<OrderRecord>().toEqualTypeOf<{
  id: number;
  number: string;
  status: 'open' | 'paid';
  total: string;
  qty: number;
  views: bigint;
  tags: string[];
  customer: string;
  ref?: string;
  lines?: { sku: string }[];
  meta?: unknown;
  shippedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}>();
expectTypeOf<InferTableRecord<typeof Order>>().toEqualTypeOf<OrderRecord>();
type NewOrder = InferCreate<typeof Order>;
expectTypeOf<NewOrder['total']>().toEqualTypeOf<string | number>();
expectTypeOf<NewOrder['views']>().toEqualTypeOf<bigint | number | undefined>();

// Ids follow options.id.
const U = defineTable('U', { a: { type: 'string' } });
const B = defineTable('B', { a: { type: 'string' } }, { id: 'bigserial', timestamps: false });
expectTypeOf<InferRecord<typeof U>['id']>().toEqualTypeOf<string>();
expectTypeOf<InferRecord<typeof B>>().toEqualTypeOf<{ id: bigint; a?: string }>();

async function usage() {
  // select / omit narrow the result
  const picked = await Order.findMany({ select: { number: true, total: true } });
  expectTypeOf(picked).toEqualTypeOf<{ number: string; total: string }[]>();
  const omitted = await Order.findFirst({
    where: { qty: { gt: 1 } },
    omit: { meta: true, lines: true },
  });
  expectTypeOf(omitted).toEqualTypeOf<Omit<OrderRecord, 'meta' | 'lines'> | null>();
  const full = await Order.findUniqueOrThrow({ where: { number: 'A-1' } });
  expectTypeOf(full).toEqualTypeOf<OrderRecord>();

  // filters by field kind
  await Order.findMany({
    where: {
      number: { startsWith: 'A', mode: 'insensitive' },
      status: { in: ['open'] },
      total: { gte: '10.00' },
      qty: { not: 3 },
      views: { gt: 10n },
      tags: { hasSome: ['x'] },
      meta: { path: ['level'], gte: 3 },
      shippedAt: { lt: '2024-01-01' },
      OR: [{ customer: 'a' }, { customer: { endsWith: 'b' } }],
      NOT: { status: 'paid' },
    },
    orderBy: [{ createdAt: 'desc' }, { qty: { sort: 'asc', nulls: 'last' } }],
    cursor: { id: 5 },
    take: 10,
    skip: 1,
    distinct: ['customer'],
  });
  // @ts-expect-error — not an enum value
  await Order.findMany({ where: { status: 'shipped' } });
  // @ts-expect-error — string filter on a number field
  await Order.findMany({ where: { qty: { contains: '1' } } });
  // @ts-expect-error — list filter on a scalar field
  await Order.findMany({ where: { customer: { has: 'x' } } });
  // @ts-expect-error — arrays / json aren't sortable
  await Order.findMany({ orderBy: { tags: 'asc' } });
  // @ts-expect-error — undeclared field
  await Order.findMany({ where: { nope: 1 } });
  // @ts-expect-error — select and omit together
  await Order.findMany({ select: { qty: true }, omit: { qty: true } });

  // unique lookups: id, unique field, compound unique index
  await Order.findUnique({ where: { id: 1 } });
  await Order.findUnique({ where: { customer: 'a', qty: 2 } });
  // @ts-expect-error — not a unique key
  await Order.findUnique({ where: { status: 'open' } });
  // @ts-expect-error — half of a compound key
  await Order.findUnique({ where: { customer: 'a' } });

  // writes
  await Order.create({ data: { number: 'A', total: 9.5, qty: 1, customer: 'c', views: 3 } });
  // @ts-expect-error — required qty missing
  await Order.create({ data: { number: 'A', total: '1', customer: 'c' } });
  await Order.update({
    where: { number: 'A' },
    data: {
      qty: { increment: 1 },
      views: { increment: 2n },
      total: { decrement: '0.5' },
      tags: { push: 'x' },
      shippedAt: null,
    },
  });
  // @ts-expect-error — increment on a string field
  await Order.update({ where: { number: 'A' }, data: { customer: { increment: 1 } } });
  const up = await Order.upsert({
    where: { number: 'A' },
    create: { number: 'A', total: '1', qty: 1, customer: 'c' },
    update: { qty: { increment: 1 } },
    select: { id: true, qty: true },
  });
  expectTypeOf(up).toEqualTypeOf<{ id: number; qty: number }>();
  expectTypeOf(await Order.createMany({ data: [] })).toEqualTypeOf<{ count: number }>();
  expectTypeOf(await Order.deleteMany({ where: { qty: 0 } })).toEqualTypeOf<{ count: number }>();

  // aggregates
  const agg = await Order.aggregate({
    _count: true,
    _sum: { total: true, qty: true, views: true },
    _avg: { qty: true, total: true },
    _min: { shippedAt: true },
    _max: { number: true },
  });
  expectTypeOf(agg).toEqualTypeOf<{
    _count: number;
    _sum: { total: string | null; qty: number | null; views: bigint | null };
    _avg: { qty: number | null; total: string | null };
    _min: { shippedAt: Date | null };
    _max: { number: string | null };
  }>();
  // @ts-expect-error — _sum on a string field
  await Order.aggregate({ _sum: { customer: true } });
  const groups = await Order.groupBy({
    by: ['status', 'customer'],
    _count: { _all: true },
    _sum: { total: true },
    having: { total: { _sum: { gt: 100 } } },
    orderBy: { _sum: { total: 'desc' } },
  });
  expectTypeOf(groups).toEqualTypeOf<
    {
      status: 'open' | 'paid' | null;
      customer: string | null;
      _count: { _all: number };
      _sum: { total: string | null };
    }[]
  >();
  expectTypeOf(await Order.count({ where: { qty: 1 } })).toEqualTypeOf<number>();
  expectTypeOf(await Order.count({ select: { _all: true, ref: true } })).toEqualTypeOf<{
    _all: number;
    ref: number;
  }>();

  // Engine-native APIs are separate: no Mongo-style methods on a table, no Prisma ones on a model.
  // @ts-expect-error — defineModel vocabulary
  await Order.find({ qty: 1 });
  const M = defineModel('M', { a: { type: 'string' } });
  // @ts-expect-error — defineTable vocabulary
  await M.findMany({});
}

// SQL-only types are refused by defineModel at compile time too.
// @ts-expect-error — integer is defineTable-only
defineModel('X', { n: { type: 'integer' } });

void usage;
