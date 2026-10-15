// Type-level tests for schema inference. Checked by `tsc` (npm run typecheck), not run by
// vitest: every `@ts-expect-error` below is a call that must NOT compile.
/* eslint-disable @typescript-eslint/no-unused-vars -- models are only inspected via `typeof` */
import { expectTypeOf } from 'vitest';
import { defineModel } from '../../index.js';
import type { InferCreate, InferRecord, ModelCRUD, ModelRecord, ModelSchema } from '../../index.js';

const User = defineModel('User', {
  name: { type: 'string', required: true },
  email: { type: 'string', required: true, unique: true },
  role: { type: 'string', enum: ['member', 'admin'], default: 'member' },
  level: { type: 'number', enum: [1, 2, 3] },
  age: { type: 'number' },
  active: { type: 'boolean', default: true },
  birthday: { type: 'date' },
  manager: { type: 'objectId', ref: 'User' },
  friends: { type: 'array', of: 'objectId', ref: 'User' },
  tags: { type: 'array', of: 'string', default: [] },
  anything: { type: 'object' },
  list: { type: 'array' },
  seq: { type: 'number', sequence: true },
  address: { city: { type: 'string', required: true }, zip: { type: 'string' } },
  billing: {
    type: 'object',
    required: true,
    fields: { iban: { type: 'string', required: true }, since: { type: 'date' } },
  },
  items: [{ sku: { type: 'string', required: true }, qty: { type: 'number', default: 1 } }],
  lines: { type: 'array', of: { note: { type: 'string', required: true } } },
});

type UserRecord = InferRecord<typeof User>;

expectTypeOf<UserRecord>().toEqualTypeOf<{
  id: string;
  name: string;
  email: string;
  role: 'member' | 'admin';
  active: boolean;
  tags: string[];
  seq: number;
  billing: { iban: string; since?: Date };
  level?: 1 | 2 | 3;
  age?: number;
  birthday?: Date;
  manager?: string;
  friends?: string[];
  anything?: unknown;
  list?: unknown[];
  address?: { city: string; zip?: string };
  items?: { sku: string; qty: number }[];
  lines?: { note: string }[];
  createdAt: Date;
  updatedAt: Date;
}>();

// Create input: required-without-default is mandatory; dates accept strings; no timestamps.
type NewUser = InferCreate<typeof User>;
expectTypeOf<NewUser['name']>().toEqualTypeOf<string>();
expectTypeOf<NewUser['birthday']>().toEqualTypeOf<Date | string | number | undefined>();
expectTypeOf<Extract<keyof NewUser, 'createdAt' | 'updatedAt' | 'id'>>().toEqualTypeOf<never>();

async function usage() {
  const u = await User.create({ name: 'a', email: 'a@x.io', billing: { iban: 'DE00' } });
  expectTypeOf(u.role).toEqualTypeOf<'member' | 'admin'>();
  expectTypeOf(u.createdAt).toEqualTypeOf<Date>();

  await User.create({
    name: 'a',
    email: 'a@x.io',
    billing: { iban: 'DE00', since: '2024-01-01' },
    birthday: undefined, // optional input fields accept undefined (req.body values)
    items: [{ sku: 'x' }],
  });

  // @ts-expect-error — email is required
  await User.create({ name: 'a', billing: { iban: 'DE00' } });
  // @ts-expect-error — not an enum value
  await User.create({ name: 'a', email: 'e', billing: { iban: 'x' }, role: 'owner' });
  // @ts-expect-error — undeclared field
  await User.create({ name: 'a', email: 'e', billing: { iban: 'x' }, nope: 1 });
  // @ts-expect-error — nested required field missing
  await User.create({ name: 'a', email: 'e', billing: {} });
  // @ts-expect-error — wrong scalar type
  await User.create({ name: 'a', email: 'e', billing: { iban: 'x' }, age: '3' });

  // Filters and updates are typed from the record.
  await User.find({ role: { $in: ['admin'] }, createdAt: { $gte: new Date() } });
  // @ts-expect-error — not an enum value
  await User.find({ role: 'owner' });
  await User.update('id', { $inc: { age: 1 }, $set: { name: 'b' } });
  // @ts-expect-error — wrong type in update
  await User.update('id', { name: 1 });

  // Portable additions.
  const up = await User.upsert(
    { email: 'a@x.io' },
    { name: 'a', email: 'a@x.io', billing: { iban: 'x' } },
    { $set: { name: 'a' } },
  );
  expectTypeOf<Simplify<typeof up>>().toEqualTypeOf<UserRecord>();
  const one = await User.updateOne({ email: 'a' }, { name: 'b' });
  expectTypeOf<Simplify<NonNullable<typeof one>>>().toEqualTypeOf<UserRecord>();
  expectTypeOf(one).toBeNullable();
  const gone = await User.deleteOne({ email: 'a' });
  expectTypeOf<Simplify<NonNullable<typeof gone>>>().toEqualTypeOf<UserRecord>();
  expectTypeOf(gone).toBeNullable();
  expectTypeOf(await User.exists({ email: 'a' })).toEqualTypeOf<boolean>();
  expectTypeOf(await User.distinct('role')).toEqualTypeOf<('member' | 'admin')[]>();
  expectTypeOf(await User.distinct('birthday', { active: true })).toEqualTypeOf<Date[]>();
  expectTypeOf(await User.distinct('id')).toEqualTypeOf<string[]>();
  // @ts-expect-error — arrays/objects can't be distinct()-ed
  await User.distinct('tags');
  // @ts-expect-error — unknown field
  await User.distinct('nope');
}

// Timestamps follow the options.
const NoTs = defineModel('NoTs', { a: { type: 'string' } }, { timestamps: false });
expectTypeOf<InferRecord<typeof NoTs>>().toEqualTypeOf<{ id: string; a?: string }>();

const Renamed = defineModel(
  'Renamed',
  { a: { type: 'string' } },
  { timestamps: { createdAt: 'created_at', updatedAt: false } },
);
expectTypeOf<InferRecord<typeof Renamed>>().toEqualTypeOf<{
  id: string;
  a?: string;
  created_at: Date;
}>();

// The explicit generic keeps working exactly as in v0.4.
interface Legacy {
  title: string;
  pages?: number;
}
const Book = defineModel<Legacy>('Book', { title: { type: 'string' }, pages: { type: 'number' } });
expectTypeOf(Book).toEqualTypeOf<ModelCRUD<Legacy>>();
expectTypeOf<InferRecord<typeof Book>>().toEqualTypeOf<{
  id: string;
  title: string;
  pages?: number;
}>();
expectTypeOf(await Book.findById('x')).toEqualTypeOf<ModelRecord<Legacy> | null>();
void Book.create({}); // Partial<T>, as before

// A schema widened to ModelSchema has nothing to infer from: loose, as in v0.4.
const schema: ModelSchema = { a: { type: 'string' } };
const Loose = defineModel('Loose', schema);
expectTypeOf(Loose).toEqualTypeOf<ModelCRUD<object>>();

// A schema kept in a variable keeps its types with `as const satisfies ModelSchema`.
const shared = {
  title: { type: 'string', required: true },
  kind: { type: 'string', enum: ['a', 'b'] },
  parts: [{ n: { type: 'number', required: true } }],
} as const satisfies ModelSchema;
const Shared = defineModel('Shared', shared);
expectTypeOf<InferRecord<typeof Shared>>().toEqualTypeOf<{
  id: string;
  title: string;
  kind?: 'a' | 'b';
  parts?: { n: number }[];
  createdAt: Date;
  updatedAt: Date;
}>();

type Simplify<T> = { [K in keyof T]: T[K] } & {};

void usage;
