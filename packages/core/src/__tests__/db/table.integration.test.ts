import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { defineTable } from '../../db/table-model.js';
import { defineModel } from '../../db/model.js';
import { setDbEngine } from '../../db/engine.js';
import { connectPostgres, closePostgres, getPool } from '../../db/postgres.js';
import { transaction } from '../../db/transaction.js';
import { snakeCase, tableNameFor } from '../../db/pg-table.js';
import { ModelValidationError } from '../../db/schema.js';
import { HttpError } from '../../errors.js';

// defineTable — the PostgreSQL-native API. The suites follow Prisma's guides (CRUD,
// filtering and sorting, pagination, aggregation) plus what the table looks like in
// PostgreSQL itself. Skips when PostgreSQL isn't reachable (CI provides it).
const PG_URL = process.env['EFC_TEST_PG_URL'] ?? 'postgres://postgres@127.0.0.1:5433/efc_test';

async function reachablePg(url: string): Promise<boolean> {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

const available = await reachablePg(PG_URL);
const s = Math.random().toString(36).slice(2, 7);

const User = defineTable(
  `TUser${s}`,
  {
    email: { type: 'string', required: true, unique: true, maxLength: 120 },
    name: { type: 'string' },
    role: { type: 'string', enum: ['USER', 'ADMIN'], default: 'USER', nativeEnum: true },
    age: { type: 'integer', min: 0 },
    balance: { type: 'decimal', precision: 12, scale: 2, default: '0' },
    views: { type: 'bigint', default: 0n },
    tags: { type: 'array', of: 'string', default: [] },
    scores: { type: 'array', of: 'integer' },
    profile: { bio: { type: 'string' }, city: { type: 'string' }, since: { type: 'date' } },
    meta: { type: 'json' },
    lastLogin: { type: 'date' },
  },
  { naming: 'snake_case' },
);

const Order = defineTable(
  `TOrder${s}`,
  {
    number: { type: 'string', required: true, unique: true },
    status: { type: 'string', enum: ['open', 'paid', 'shipped'], default: 'open' },
    total: { type: 'decimal', precision: 10, scale: 2, required: true },
    qty: { type: 'integer', required: true },
    customer: { type: 'string', required: true },
    placedAt: { type: 'date', default: '$now' },
  },
  { id: 'serial', indexes: [{ fields: { customer: 1, number: 1 }, unique: true }] },
);

const tableOf = (base: string) =>
  base === 'user' ? tableNameFor(snakeCase(`TUser${s}`)) : tableNameFor(`TOrder${s}`);

describe.skipIf(!available)('defineTable (PostgreSQL)', () => {
  beforeAll(async () => {
    setDbEngine('postgresql');
    await connectPostgres(PG_URL);
  });

  afterAll(async () => {
    await User.drop();
    await Order.drop();
    await getPool().query(`DROP TYPE IF EXISTS "${tableOf('user')}_role_enum"`);
    await closePostgres();
  });

  describe('schema in PostgreSQL', () => {
    it('creates SQL-native columns, snake_case names, a native enum and an identity id', async () => {
      await User.sync();
      await Order.sync();
      const cols = Object.fromEntries(
        (
          await getPool().query<{ column_name: string; type: string }>(
            `SELECT a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS type
             FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
             WHERE c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped`,
            [tableOf('user')],
          )
        ).rows.map((r) => [r.column_name, r.type]),
      );
      expect(cols).toMatchObject({
        id: 'uuid',
        email: 'character varying(120)',
        role: `${tableOf('user')}_role_enum`,
        age: 'integer',
        balance: 'numeric(12,2)',
        views: 'bigint',
        tags: 'text[]',
        scores: 'integer[]',
        profile: 'jsonb',
        meta: 'jsonb',
        last_login: 'timestamp with time zone',
        created_at: 'timestamp with time zone',
        updated_at: 'timestamp with time zone',
      });
      const id = await getPool().query<{ identity: string }>(
        `SELECT is_identity AS identity FROM information_schema.columns WHERE table_name = $1 AND column_name = 'id'`,
        [tableOf('order')],
      );
      expect(id.rows[0]?.identity).toBe('YES');
      expect(await User.sync()).toEqual([]); // idempotent
      expect(await Order.sync()).toEqual([]);
    });
  });

  describe('CRUD', () => {
    it('create returns typed values: uuid id, bigint, exact decimals, arrays, dates', async () => {
      const u = await User.create({
        data: {
          email: 'ada@x.io',
          name: 'Ada',
          age: 36,
          balance: 1250.5,
          scores: [3, 1],
          profile: { bio: 'math', since: '2020-01-02T00:00:00Z' },
          meta: { flags: ['a'] },
        },
      });
      expect(u.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(u).toMatchObject({
        email: 'ada@x.io',
        role: 'USER',
        age: 36,
        balance: '1250.50',
        views: 0n,
        tags: [],
        scores: [3, 1],
        meta: { flags: ['a'] },
      });
      expect(u.profile?.since).toBeInstanceOf(Date);
      expect(u.createdAt).toBeInstanceOf(Date);

      const o = await Order.create({
        data: { number: 'A-1', total: '19.99', qty: 2, customer: 'ada' },
      });
      expect(typeof o.id).toBe('number');
      expect(o.total).toBe('19.99');
      expect(o.placedAt).toBeInstanceOf(Date);
    });

    it('validates on create: required, enum, integer, decimal scale, varchar length, min', async () => {
      const bad = async (data: object) => {
        const err = await User.create({ data: data as never }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ModelValidationError);
        return (err as ModelValidationError).issues.map((i) => i.path);
      };
      expect(await bad({ name: 'x' })).toContain('email');
      expect(await bad({ email: 'b@x.io', role: 'ROOT' })).toContain('role');
      expect(await bad({ email: 'b@x.io', age: 1.5 })).toContain('age');
      expect(await bad({ email: 'b@x.io', age: -1 })).toContain('age');
      expect(await bad({ email: 'b@x.io', balance: '1.234' })).toContain('balance');
      expect(await bad({ email: 'x'.repeat(121) })).toContain('email');
      expect(await bad({ email: 'b@x.io', views: 1.5 })).toContain('views');
    });

    it('rejects duplicates with 409 and finds by unique keys', async () => {
      await expect(User.create({ data: { email: 'ada@x.io' } })).rejects.toMatchObject({
        statusCode: 409,
      });
      const byEmail = await User.findUnique({ where: { email: 'ada@x.io' } });
      expect(byEmail?.name).toBe('Ada');
      expect((await User.findUnique({ where: { id: byEmail!.id } }))?.email).toBe('ada@x.io');
      expect(await User.findUnique({ where: { email: 'none@x.io' } })).toBeNull();
      await expect(User.findUnique({ where: { name: 'Ada' } as never })).rejects.toBeInstanceOf(
        ModelValidationError,
      );
      await expect(User.findUniqueOrThrow({ where: { email: 'none@x.io' } })).rejects.toMatchObject(
        {
          statusCode: 404,
        },
      );
      // compound unique index
      expect((await Order.findUnique({ where: { customer: 'ada', number: 'A-1' } }))?.qty).toBe(2);
    });

    it('update applies Prisma operations and refreshes updatedAt; 404 when missing', async () => {
      const before = await User.findUniqueOrThrow({ where: { email: 'ada@x.io' } });
      const u = await User.update({
        where: { email: 'ada@x.io' },
        data: {
          name: 'Ada L.',
          age: { increment: 1 },
          views: { increment: 5n },
          balance: { decrement: '0.50' },
          tags: { push: ['vip', 'beta'] },
          lastLogin: '2024-05-01T10:00:00Z',
        },
      });
      expect(u).toMatchObject({ name: 'Ada L.', age: 37, views: 5n, balance: '1250.00' });
      expect(u.tags).toEqual(['vip', 'beta']);
      expect(u.lastLogin).toEqual(new Date('2024-05-01T10:00:00Z'));
      expect(u.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
      await expect(
        User.update({ where: { email: 'ada@x.io' }, data: { age: -5 } }),
      ).rejects.toBeInstanceOf(ModelValidationError);
      await expect(
        User.update({ where: { email: 'ada@x.io' }, data: { name: { increment: 1 } } as never }),
      ).rejects.toBeInstanceOf(ModelValidationError);
      await expect(
        User.update({ where: { email: 'nobody@x.io' }, data: { name: 'x' } }),
      ).rejects.toMatchObject({ statusCode: 404 });
      // unsetting an optional field
      expect(
        (await User.update({ where: { email: 'ada@x.io' }, data: { lastLogin: null } })).lastLogin,
      ).toBeUndefined();
    });

    it('upsert is one INSERT … ON CONFLICT, safe under concurrency', async () => {
      const a = await User.upsert({
        where: { email: 'grace@x.io' },
        create: { email: 'grace@x.io', name: 'Grace', age: 40 },
        update: { age: { increment: 1 } },
      });
      expect(a.age).toBe(40);
      const b = await User.upsert({
        where: { email: 'grace@x.io' },
        create: { email: 'grace@x.io', name: 'Grace', age: 40 },
        update: { age: { increment: 1 } },
      });
      expect(b.id).toBe(a.id);
      expect(b.age).toBe(41);
      const racers = await Promise.all(
        Array.from({ length: 8 }, () =>
          User.upsert({
            where: { email: 'race@x.io' },
            create: { email: 'race@x.io', age: 0 },
            update: { age: { increment: 1 } },
          }),
        ),
      );
      expect(new Set(racers.map((r) => r.id)).size).toBe(1);
      expect((await User.findUniqueOrThrow({ where: { email: 'race@x.io' } })).age).toBe(7);
      // create values come from `where` when omitted; empty update returns the row
      const c = await User.upsert({
        where: { email: 'grace@x.io' },
        create: { email: 'grace@x.io' },
        update: {},
      });
      expect(c.age).toBe(41);
    });

    it('createMany / createManyAndReturn / updateMany / delete / deleteMany', async () => {
      expect(
        await User.createMany({
          data: [
            { email: 'u1@x.io', name: 'Zed', age: 20, tags: ['a'], role: 'ADMIN' },
            { email: 'u2@x.io', name: 'amy', age: 25, tags: ['a', 'b'] },
            { email: 'ada@x.io' }, // duplicate, skipped
          ],
          skipDuplicates: true,
        }),
      ).toEqual({ count: 2 });
      const made = await User.createManyAndReturn({
        data: [
          { email: 'u3@x.io', name: 'Bob', age: 30, scores: [5, 9], profile: { city: 'Oslo' } },
          {
            email: 'u4@x.io',
            age: 18,
            profile: { city: 'Lima' },
            meta: { level: 3, name: 'Gold' },
          },
        ],
        select: { email: true, age: true },
      });
      expect(made).toEqual([
        { email: 'u3@x.io', age: 30 },
        { email: 'u4@x.io', age: 18 },
      ]);
      expect(
        await User.updateMany({ where: { age: { lt: 21 } }, data: { views: { increment: 1n } } }),
      ).toEqual({
        count: 3, // u1 (20), u4 (18), race (7)
      });
      const tmp = await User.create({ data: { email: 'tmp@x.io' } });
      const gone = await User.delete({ where: { id: tmp.id } });
      expect(gone.email).toBe('tmp@x.io');
      await expect(User.delete({ where: { id: tmp.id } })).rejects.toMatchObject({
        statusCode: 404,
      });
      await User.create({ data: { email: 'tmp2@x.io', role: 'ADMIN' } });
      expect(await User.deleteMany({ where: { email: { startsWith: 'tmp' } } })).toEqual({
        count: 1,
      });
    });
  });

  describe('filtering and sorting', () => {
    const emails = (rows: { email?: string }[]) => rows.map((r) => r.email).sort();

    it('scalar filters: equals, not, in/notIn, ranges, strings, mode insensitive', async () => {
      expect(
        emails(await User.findMany({ where: { name: { contains: 'a', mode: 'insensitive' } } })),
      ).toEqual(['ada@x.io', 'grace@x.io', 'u2@x.io']);
      expect(emails(await User.findMany({ where: { name: { startsWith: 'A' } } }))).toEqual([
        'ada@x.io',
      ]);
      expect(emails(await User.findMany({ where: { name: { endsWith: 'ob' } } }))).toEqual([
        'u3@x.io',
      ]);
      expect(
        emails(await User.findMany({ where: { name: { equals: 'AMY', mode: 'insensitive' } } })),
      ).toEqual(['u2@x.io']);
      expect(emails(await User.findMany({ where: { age: { gte: 25, lt: 37 } } }))).toEqual([
        'u2@x.io',
        'u3@x.io',
      ]);
      expect(
        emails(await User.findMany({ where: { email: { in: ['u1@x.io', 'u2@x.io'] } } })),
      ).toEqual(['u1@x.io', 'u2@x.io']);
      expect(await User.count({ where: { email: { in: [] } } })).toBe(0);
      expect(emails(await User.findMany({ where: { role: 'ADMIN' } }))).toEqual(['u1@x.io']);
      expect(emails(await User.findMany({ where: { role: { not: 'USER' } } }))).toEqual([
        'u1@x.io',
      ]);
      expect(emails(await User.findMany({ where: { name: null } }))).toEqual([
        'race@x.io',
        'u4@x.io',
      ]);
      expect(emails(await User.findMany({ where: { name: { contains: '%' } } }))).toEqual([]); // LIKE-escaped
      expect(await User.count({ where: { balance: { gt: '1000' } } })).toBe(1);
    });

    it('AND / OR / NOT combine, undefined is ignored, undeclared fields match nothing', async () => {
      expect(
        emails(
          await User.findMany({
            where: { OR: [{ age: { lt: 19 } }, { name: 'Zed' }], NOT: { email: 'u1@x.io' } },
          }),
        ),
      ).toEqual(['race@x.io', 'u4@x.io']);
      expect(
        emails(await User.findMany({ where: { AND: [{ age: { gt: 19 } }, { age: { lt: 26 } }] } })),
      ).toEqual(['u1@x.io', 'u2@x.io']);
      expect(await User.count({ where: { name: undefined } })).toBe(await User.count());
      expect(await User.count({ where: { nope: 1 } as never })).toBe(0);
    });

    it('scalar list and JSON filters', async () => {
      expect(emails(await User.findMany({ where: { tags: { has: 'b' } } }))).toEqual(['u2@x.io']);
      expect(emails(await User.findMany({ where: { tags: { hasEvery: ['a', 'b'] } } }))).toEqual([
        'u2@x.io',
      ]);
      expect(emails(await User.findMany({ where: { tags: { hasSome: ['vip', 'b'] } } }))).toEqual([
        'ada@x.io',
        'u2@x.io',
      ]);
      expect(await User.count({ where: { tags: { isEmpty: false } } })).toBe(3);
      expect(emails(await User.findMany({ where: { scores: { has: 9 } } }))).toEqual(['u3@x.io']);
      expect(
        emails(await User.findMany({ where: { profile: { path: ['city'], equals: 'Oslo' } } })),
      ).toEqual(['u3@x.io']);
      expect(emails(await User.findMany({ where: { meta: { path: ['level'], gte: 3 } } }))).toEqual(
        ['u4@x.io'],
      );
      expect(
        emails(
          await User.findMany({
            where: { meta: { path: ['name'], string_starts_with: 'go', mode: 'insensitive' } },
          }),
        ),
      ).toEqual(['u4@x.io']);
      expect(
        emails(await User.findMany({ where: { meta: { path: ['flags'], array_contains: 'a' } } })),
      ).toEqual(['ada@x.io']);
    });

    it('orderBy (multi-key, nulls), select, omit and distinct', async () => {
      const sorted = await User.findMany({
        orderBy: [{ role: 'desc' }, { age: { sort: 'asc', nulls: 'last' } }],
        select: { email: true, age: true },
      });
      expect(sorted[0]).toEqual({ email: 'u1@x.io', age: 20 }); // ADMIN first (enum order)
      expect(sorted.at(-1)).toEqual({ email: 'grace@x.io', age: 41 });
      expect(Object.keys(sorted[1]!).sort()).toEqual(['age', 'email']);
      const omitted = await User.findFirst({
        where: { email: 'ada@x.io' },
        omit: { meta: true, profile: true },
      });
      expect(omitted).not.toHaveProperty('meta');
      expect(omitted).toHaveProperty('email');
      const roles = await User.findMany({
        distinct: ['role'],
        orderBy: { role: 'asc' },
        select: { role: true },
      });
      expect(roles).toEqual([{ role: 'USER' }, { role: 'ADMIN' }]);
    });
  });

  describe('pagination', () => {
    beforeAll(async () => {
      await Order.createMany({
        data: Array.from({ length: 12 }, (_, i) => ({
          number: `P-${String(i).padStart(2, '0')}`,
          total: (10 + i * 2.5).toFixed(2),
          qty: (i % 3) + 1,
          status: (['open', 'paid', 'shipped'] as const)[i % 3],
          customer: i % 2 ? 'bob' : 'cy',
        })),
      });
    });

    it('offset: skip + take', async () => {
      const page = await Order.findMany({
        where: { number: { startsWith: 'P-' } },
        orderBy: { number: 'asc' },
        skip: 4,
        take: 3,
      });
      expect(page.map((o) => o.number)).toEqual(['P-04', 'P-05', 'P-06']);
    });

    it('cursor: walks every row exactly once in a non-unique order', async () => {
      const seen: string[] = [];
      let cursor: number | undefined;
      for (;;) {
        const page = await Order.findMany({
          where: { number: { startsWith: 'P-' } },
          orderBy: [{ qty: 'desc' }],
          take: 5,
          ...(cursor !== undefined && { cursor: { id: cursor }, skip: 1 }),
        });
        if (page.length === 0) break;
        seen.push(...page.map((o) => o.number));
        cursor = page.at(-1)!.id;
      }
      expect(seen).toHaveLength(12);
      expect(new Set(seen).size).toBe(12);
      const qtys = (await Order.findMany({ where: { number: { in: seen } } })).reduce<
        Record<string, number>
      >((m, o) => ({ ...m, [o.number]: o.qty }), {});
      const order = seen.map((n) => qtys[n]!);
      expect(order).toEqual([...order].sort((a, b) => b - a));
      // A cursor that doesn't exist yields nothing.
      expect(await Order.findMany({ cursor: { id: 999999 }, take: 3 })).toEqual([]);
    });

    it('negative take reads backwards from the cursor', async () => {
      const all = await Order.findMany({
        where: { number: { startsWith: 'P-' } },
        orderBy: { number: 'asc' },
      });
      const mid = all[6]!;
      const before = await Order.findMany({
        where: { number: { startsWith: 'P-' } },
        orderBy: { number: 'asc' },
        cursor: { id: mid.id },
        skip: 1,
        take: -2,
      });
      expect(before.map((o) => o.number)).toEqual(['P-04', 'P-05']);
      const last = await Order.findFirst({
        where: { number: { startsWith: 'P-' } },
        orderBy: { number: 'asc' },
        take: -1,
      });
      expect(last?.number).toBe('P-11');
    });
  });

  describe('aggregation', () => {
    it('aggregate: _count, _sum, _avg, _min, _max with exact types', async () => {
      const r = await Order.aggregate({
        where: { number: { startsWith: 'P-' } },
        _count: { _all: true, status: true },
        _sum: { total: true, qty: true },
        _avg: { qty: true, total: true },
        _min: { total: true, placedAt: true },
        _max: { number: true },
      });
      expect(r._count).toEqual({ _all: 12, status: 12 });
      expect(r._sum.total).toBe('285.00'); // exact decimal string
      expect(r._sum.qty).toBe(24);
      expect(r._avg.qty).toBe(2);
      expect(r._avg.total).toBe(String(r._avg.total)); // decimal avg stays a string
      expect(Number(r._avg.total)).toBeCloseTo(23.75);
      expect(r._min.total).toBe('10.00');
      expect(r._min.placedAt).toBeInstanceOf(Date);
      expect(r._max.number).toBe('P-11');
      const big = await User.aggregate({ _sum: { views: true }, _count: true });
      expect(typeof big._sum.views).toBe('bigint');
      expect(typeof big._count).toBe('number');
      const none = await Order.aggregate({
        where: { qty: 99 },
        _sum: { total: true },
        _count: true,
      });
      expect(none).toEqual({ _sum: { total: null }, _count: 0 });
      // aggregate over a page
      const firstThree = await Order.aggregate({
        where: { number: { startsWith: 'P-' } },
        orderBy: { number: 'asc' },
        take: 3,
        _sum: { qty: true },
      });
      expect(firstThree._sum.qty).toBe(6);
    });

    it('groupBy with aggregates, having, orderBy and take', async () => {
      const groups = await Order.groupBy({
        by: ['status'],
        where: { number: { startsWith: 'P-' } },
        _count: { _all: true },
        _sum: { total: true },
        _avg: { qty: true },
        having: { total: { _sum: { gt: 90 } } },
        orderBy: { _sum: { total: 'desc' } },
      });
      expect(groups.map((g) => g.status)).toEqual(['shipped', 'paid']); // open sums to 85
      expect(groups[0]).toEqual({
        status: 'shipped',
        _count: { _all: 4 },
        _sum: { total: '105.00' },
        _avg: { qty: 3 },
      });
      const byTwo = await Order.groupBy({
        by: ['customer', 'status'],
        where: { number: { startsWith: 'P-' } },
        _count: true,
        orderBy: [{ customer: 'asc' }, { status: 'asc' }],
        take: 2,
      });
      expect(byTwo).toEqual([
        { customer: 'bob', status: 'open', _count: 2 },
        { customer: 'bob', status: 'paid', _count: 2 },
      ]);
    });

    it('count with select counts non-null values per field', async () => {
      expect(await User.count({ select: { _all: true, name: true, age: true } })).toEqual({
        _all: 7,
        name: 5,
        age: 7,
      });
    });
  });

  describe('foundation', () => {
    it('joins transaction() and rolls back', async () => {
      await expect(
        transaction(async () => {
          await User.create({ data: { email: 'tx@x.io' } });
          await Order.update({ where: { number: 'A-1' }, data: { qty: 99 } });
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect(await User.findUnique({ where: { email: 'tx@x.io' } })).toBeNull();
      expect((await Order.findUnique({ where: { number: 'A-1' } }))?.qty).toBe(2);
    });

    it('defineModel and defineTable over the same table read and write the same records', async () => {
      const shared = `shared_${s}`;
      const AsTable = defineTable(
        `SharedT${s}`,
        {
          title: { type: 'string', required: true },
          pages: { type: 'number' },
          tags: { type: 'array', of: 'string' },
          published: { type: 'date' },
        },
        { collection: shared },
      );
      const AsModel = defineModel(
        `SharedM${s}`,
        {
          title: { type: 'string', required: true },
          pages: { type: 'number' },
          published: { type: 'date' },
        },
        { collection: shared },
      );
      const a = await AsTable.create({
        data: { title: 'T', pages: 10, published: new Date('2024-01-01Z') },
      });
      const viaModel = await AsModel.findById(a.id);
      expect(viaModel).toMatchObject({ title: 'T', pages: 10, published: new Date('2024-01-01Z') });
      const b = await AsModel.create({ title: 'M', pages: 3 });
      expect(await AsTable.findUnique({ where: { id: b.id } })).toMatchObject({
        title: 'M',
        pages: 3,
      });
      await AsTable.drop();
    });

    it('errors clearly on MongoDB and for invalid table schemas', async () => {
      setDbEngine('mongodb');
      try {
        await expect(User.findMany()).rejects.toThrow(
          /is a PostgreSQL table \(defineTable\) but the app is connected to MongoDB/,
        );
      } finally {
        setDbEngine('postgresql');
      }
      expect(() => defineModel('Bad', { n: { type: 'integer' } } as never)).toThrow(
        /PostgreSQL-only — use defineTable/,
      );
      expect(() => defineTable('Bad2', { n: { type: 'string', precision: 3 } })).toThrow(
        /only apply to decimal/,
      );
      expect(() =>
        defineTable('Bad3', { r: { type: 'number', enum: [1, 2], nativeEnum: true } }),
      ).toThrow(/nativeEnum/);
    });

    it('sync converts an existing jsonb array column to a native array and keeps the data', async () => {
      const t = `conv_${s}`;
      const Old = defineModel(
        `ConvM${s}`,
        { tags: { type: 'array', of: 'string' }, n: { type: 'number' } },
        { collection: t },
      );
      await Old.create({ tags: ['x', 'y'], n: 4 });
      const New = defineTable(
        `ConvT${s}`,
        { tags: { type: 'array', of: 'string' }, n: { type: 'integer' } },
        { collection: t },
      );
      const plan = await New.sync({ dryRun: true });
      expect(plan.join('\n')).toMatch(/ALTER COLUMN "tags" TYPE text\[\]/);
      expect(plan.join('\n')).toMatch(/ALTER COLUMN "n" TYPE integer/);
      await New.sync();
      const [row] = await New.findMany();
      expect(row).toMatchObject({ tags: ['x', 'y'], n: 4 });
      expect(await New.sync()).toEqual([]);
      await New.drop();
    });
  });
});

void HttpError;
