import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { defineTable } from '../../db/table-model.js';
import { setDbEngine } from '../../db/engine.js';
import { connectPostgres, closePostgres, getPool } from '../../db/postgres.js';
import { tableNameFor } from '../../db/pg-table.js';
import { ModelValidationError } from '../../db/schema.js';
import { onQuery, type QueryEvent } from '../../db/query-log.js';

// defineTable relations, M3a-2: an array of refs is a many-to-many relation stored in a
// join table (owner_id, ref_id, position), while records keep `tags: string[]` and the
// list filters / update ops of native arrays. Follows Prisma's many-to-many guide plus
// self-relations and the move from an array column. Skips without PostgreSQL.
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
const created: string[] = [];
const name = (base: string) => {
  const n = `${base}${s}`;
  created.push(tableNameFor(n));
  return n;
};

const TAG = name('MTag');
const POST = name('MPost');
const STUDENT = name('MStudent');
const COURSE = name('MCourse');
const PERSON = name('MPerson');

const Tag = defineTable(TAG, { label: { type: 'string', required: true, unique: true } });
const Post = defineTable(POST, {
  title: { type: 'string', required: true, unique: true },
  tags: { type: 'array', of: 'uuid', ref: TAG },
});
const Student = defineTable(STUDENT, { name: { type: 'string' } }, { id: 'bigserial' });
const Course = defineTable(
  COURSE,
  {
    code: { type: 'string', required: true },
    students: { type: 'array', of: 'bigint', ref: STUDENT },
  },
  { id: 'serial', timestamps: false },
);
const Person = defineTable(PERSON, {
  name: { type: 'string' },
  friends: { type: 'array', of: 'objectId', ref: PERSON },
});

const posts = tableNameFor(POST);
const joinTable = `${posts}_tags`;

async function links(table: string): Promise<{ owner: string; ref: string; position: number }[]> {
  const { rows } = await getPool().query(
    `SELECT owner_id::text AS owner, ref_id::text AS ref, position FROM "${table}" ORDER BY owner_id, position`,
  );
  return rows;
}

async function columnsOf(table: string): Promise<string[]> {
  const { rows } = await getPool().query<{ c: string }>(
    `SELECT column_name AS c FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((r) => r.c);
}

async function statements(fn: () => Promise<unknown>): Promise<QueryEvent[]> {
  const events: QueryEvent[] = [];
  const off = onQuery((e) => events.push(e));
  try {
    await fn();
  } finally {
    off();
  }
  return events;
}

describe.skipIf(!available)('defineTable relations — many-to-many', () => {
  let a: string, b: string, c: string;

  beforeAll(async () => {
    setDbEngine('postgresql');
    await connectPostgres(PG_URL);
    [a, b, c] = (
      await Tag.createManyAndReturn({ data: [{ label: 'a' }, { label: 'b' }, { label: 'c' }] })
    ).map((t) => t.id) as [string, string, string];
  });

  afterAll(async () => {
    for (const t of created) {
      await getPool()
        .query(`DROP TABLE IF EXISTS "${t}" CASCADE`)
        .catch(() => {});
    }
    for (const t of [joinTable, `${tableNameFor(COURSE)}_students`]) {
      await getPool()
        .query(`DROP TABLE IF EXISTS "${t}" CASCADE`)
        .catch(() => {});
    }
    await closePostgres();
  });

  it('stores the relation in a join table with cascading keys, not a column', async () => {
    await Post.sync();
    expect(await columnsOf(posts)).not.toContain('tags');
    expect(await columnsOf(joinTable)).toEqual(['owner_id', 'ref_id', 'position']);
    const { rows } = await getPool().query(
      `SELECT conname AS name, confdeltype AS action, convalidated AS valid FROM pg_constraint
       WHERE conrelid = $1::regclass AND contype IN ('f', 'p') ORDER BY conname`,
      [joinTable],
    );
    expect(rows).toEqual([
      { name: `${joinTable}_owner_id_fkey`, action: 'c', valid: true },
      { name: `${joinTable}_pkey`, action: ' ', valid: true },
      { name: `${joinTable}_ref_id_fkey`, action: 'c', valid: true },
    ]);
    expect(await Post.sync({ dryRun: true })).toEqual([]);
  });

  it('creates with links, keeping order and dropping duplicates', async () => {
    const p = await Post.create({ data: { title: 'one', tags: [c, a, c] } });
    expect(p.tags).toEqual([c, a]);
    expect(await Post.findUnique({ where: { id: p.id } })).toMatchObject({ tags: [c, a] });
    expect((await links(joinTable)).filter((l) => l.owner === p.id)).toEqual([
      { owner: p.id, ref: c, position: 1 },
      { owner: p.id, ref: a, position: 2 },
    ]);
    const bare = await Post.create({ data: { title: 'bare' } });
    expect(bare.tags).toEqual([]);
  });

  it('filters, selects and counts like a list field, in one statement', async () => {
    await Post.create({ data: { title: 'two', tags: [a, b] } });
    const titles = async (where: object) =>
      (await Post.findMany({ where, orderBy: { title: 'asc' } })).map((p) => p.title);
    expect(await titles({ tags: { has: a } })).toEqual(['one', 'two']);
    expect(await titles({ tags: { hasSome: [b, c] } })).toEqual(['one', 'two']);
    expect(await titles({ tags: { hasEvery: [a, b] } })).toEqual(['two']);
    expect(await titles({ tags: { isEmpty: true } })).toEqual(['bare']);
    expect(await titles({ tags: { equals: [c, a] } })).toEqual(['one']);
    expect(await titles({ NOT: { tags: { has: c } } })).toEqual(['bare', 'two']);
    expect(await Post.count({ where: { tags: { has: b } } })).toBe(1);
    expect(await Post.findFirst({ where: { title: 'two' }, select: { tags: true } })).toEqual({
      tags: [a, b],
    });
    expect(
      await Post.findFirst({ where: { title: 'two' }, omit: { tags: true } }),
    ).not.toHaveProperty('tags');

    const events = await statements(() => Post.findMany({ where: { tags: { has: a } } }));
    expect(events.map((e) => e.statements)).toEqual([1]);
  });

  it('updates links with set, push and a plain list', async () => {
    const p = await Post.create({ data: { title: 'three', tags: [a] } });
    const before = p.updatedAt as Date;

    const pushed = await Post.update({ where: { id: p.id }, data: { tags: { push: [b, a] } } });
    expect(pushed.tags).toEqual([a, b]); // a was there already
    expect((pushed.updatedAt as Date).getTime()).toBeGreaterThanOrEqual(before.getTime());

    expect((await Post.update({ where: { id: p.id }, data: { tags: { push: c } } })).tags).toEqual([
      a,
      b,
      c,
    ]);
    expect(
      (await Post.update({ where: { id: p.id }, data: { tags: { set: [c, a] } } })).tags,
    ).toEqual([c, a]);
    expect((await Post.update({ where: { id: p.id }, data: { tags: [b] } })).tags).toEqual([b]);
    expect((await Post.update({ where: { id: p.id }, data: { title: 'three!' } })).tags).toEqual([
      b,
    ]);
    expect((await Post.update({ where: { id: p.id }, data: { tags: { set: [] } } })).tags).toEqual(
      [],
    );
    expect((await links(joinTable)).filter((l) => l.owner === p.id)).toEqual([]);
  });

  it('updateMany and upsert maintain links', async () => {
    const many = await Post.updateManyAndReturn({
      where: { title: { in: ['one', 'two'] } },
      data: { tags: { push: b } },
    });
    expect(Object.fromEntries(many.map((p) => [p.title, p.tags]))).toEqual({
      one: [c, a, b],
      two: [a, b],
    });
    expect(
      await Post.updateMany({ where: { title: 'two' }, data: { tags: { set: [c] } } }),
    ).toEqual({ count: 1 });
    expect((await Post.findUnique({ where: { title: 'two' } }))!.tags).toEqual([c]);

    const created = await Post.upsert({
      where: { title: 'four' },
      create: { title: 'four', tags: [b, c] },
      update: { tags: { set: [a] } },
    });
    expect(created.tags).toEqual([b, c]);
    const updated = await Post.upsert({
      where: { title: 'four' },
      create: { title: 'four', tags: [b, c] },
      update: { tags: { set: [a] } },
    });
    expect(updated).toMatchObject({ id: created.id, tags: [a] });
  });

  it('createMany links every inserted row, on serial owners and bigint refs too', async () => {
    const [s1, s2] = (
      await Student.createManyAndReturn({ data: [{ name: 'x' }, { name: 'y' }] })
    ).map((r) => r.id) as [bigint, bigint];
    expect(typeof s1).toBe('bigint');

    const courses = await Course.createManyAndReturn({
      data: [{ code: 'c1', students: [s2, s1] }, { code: 'c2', students: [s1] }, { code: 'c3' }],
    });
    expect(courses.map((r) => [r.code, r.students])).toEqual([
      ['c1', [s2, s1]],
      ['c2', [s1]],
      ['c3', []],
    ]);
    expect(typeof courses[0]!.id).toBe('number');
    expect(await Course.createMany({ data: [{ code: 'c4', students: [s2] }] })).toEqual({
      count: 1,
    });
    const found = await Course.findMany({
      where: { students: { has: s2 } },
      orderBy: { code: 'asc' },
    });
    expect(found.map((r) => r.code)).toEqual(['c1', 'c4']);

    const dup = await Post.createMany({
      data: [
        { title: 'one', tags: [a] },
        { title: 'five', tags: [a, b] },
      ],
      skipDuplicates: true,
    });
    expect(dup).toEqual({ count: 1 });
    expect((await Post.findUnique({ where: { title: 'five' } }))!.tags).toEqual([a, b]);
    expect((await Post.findUnique({ where: { title: 'one' } }))!.tags).toEqual([c, a, b]);
  });

  it('removes links with either record', async () => {
    const p = await Post.create({ data: { title: 'six', tags: [a, b] } });
    const deleted = await Post.delete({ where: { id: p.id } });
    expect(deleted.tags).toEqual([a, b]);
    expect((await links(joinTable)).filter((l) => l.owner === p.id)).toEqual([]);

    const t = await Tag.create({ data: { label: 'temp' } });
    const q = await Post.create({ data: { title: 'seven', tags: [t.id, a] } });
    await Tag.delete({ where: { id: t.id } });
    expect((await Post.findUnique({ where: { id: q.id } }))!.tags).toEqual([a]);
  });

  it('rejects a missing target with a 400 and writes nothing', async () => {
    const ghost = '00000000-0000-4000-8000-000000000009';
    const err = await Post.create({ data: { title: 'ghost', tags: [a, ghost] } }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ModelValidationError);
    expect((err as ModelValidationError).issues).toEqual([
      { path: 'tags', message: `${TAG} not found` },
    ]);
    expect(await Post.findUnique({ where: { title: 'ghost' } })).toBeNull();

    const err2 = await Post.update({
      where: { title: 'two' },
      data: { tags: { push: ghost } },
    }).catch((e: unknown) => e);
    expect(err2).toBeInstanceOf(ModelValidationError);
    expect((await Post.findUnique({ where: { title: 'two' } }))!.tags).toEqual([c]);
  });

  it('supports self-relations', async () => {
    const ann = await Person.create({ data: { name: 'Ann' } });
    const bo = await Person.create({ data: { name: 'Bo', friends: [ann.id] } });
    await Person.update({ where: { id: ann.id }, data: { friends: { push: bo.id } } });
    expect(
      (await Person.findMany({ where: { friends: { has: bo.id } } })).map((p) => p.name),
    ).toEqual(['Ann']);
    await Person.delete({ where: { id: bo.id } });
    expect((await Person.findUnique({ where: { id: ann.id } }))!.friends).toEqual([]);
  });

  it('moves an existing array column into the join table on first sync, keeping it', async () => {
    for (const legacy of ['native', 'jsonb'] as const) {
      const L = name(`MLegacy${legacy}`);
      const table = tableNameFor(L);
      const type = legacy === 'native' ? 'uuid[]' : 'jsonb';
      await getPool().query(`CREATE TABLE "${table}" (id uuid PRIMARY KEY, tags ${type})`);
      const value =
        legacy === 'native'
          ? `ARRAY['${b}', '${a}']::uuid[]`
          : `'["${b}", "not-a-uuid", "${a}"]'::jsonb`;
      await getPool().query(
        `INSERT INTO "${table}" VALUES ('00000000-0000-4000-8000-0000000000a1', ${value}), ('00000000-0000-4000-8000-0000000000a2', NULL)`,
      );
      const Legacy = defineTable(L, { tags: { type: 'array', of: 'uuid', ref: TAG } });
      expect((await Legacy.findMany({ orderBy: { id: 'asc' } })).map((r) => r.tags)).toEqual([
        [b, a],
        [],
      ]);
      expect(await columnsOf(table)).toContain('tags'); // never dropped
      created.push(`${table}_tags`);
    }
  });

  it('explains bad declarations', async () => {
    expect(() =>
      defineTable('MX1', { t: { type: 'array', of: 'uuid', ref: TAG, onDelete: 'cascade' } }),
    ).toThrow(`'onDelete' doesn't apply to many-to-many refs`);
    expect(() => defineTable('MX2', { t: { type: 'array', of: 'string', ref: TAG } })).toThrow(
      `a many-to-many 'ref' needs of: objectId, uuid, integer or bigint`,
    );
    expect(() =>
      defineTable('MX3', { t: { type: 'array', of: 'uuid', ref: TAG, unique: true } }),
    ).toThrow(`'unique' / 'index' don't apply`);
    const Bad = defineTable(name('MBad'), { s: { type: 'array', of: 'uuid', ref: STUDENT } });
    await expect(Bad.sync()).rejects.toThrow(
      `whose id is bigint (id: 'bigserial') — declare it { type: 'array', of: 'bigint', ref: '${STUDENT}' }`,
    );
    await expect(Post.findMany({ orderBy: { tags: 'asc' } as never })).rejects.toThrow(
      "can't order by a many-to-many field",
    );
    await expect(Post.groupBy({ by: ['tags'] } as never)).rejects.toThrow(
      "can't group by a many-to-many field",
    );
  });
});
