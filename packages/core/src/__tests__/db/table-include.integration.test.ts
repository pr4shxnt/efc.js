import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { defineTable } from '../../db/table-model.js';
import { setDbEngine } from '../../db/engine.js';
import { connectPostgres, closePostgres, getPool } from '../../db/postgres.js';
import { tableNameFor } from '../../db/pg-table.js';
import { onQuery, type QueryEvent } from '../../db/query-log.js';

// defineTable relations, M3b: `include` loads relations — own ref fields (one / many-to-many)
// and back-relations from `options.relations` (hasMany / hasOne) — as one SQL statement at
// any depth. Follows Prisma's relations guide (1:1, 1:n, m:n, self-relations) and checks
// included records come back exactly as direct reads do. Skips without PostgreSQL.
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
const tables: string[] = [];
const name = (base: string) => {
  const n = `${base}${s}`;
  tables.push(tableNameFor(n));
  return n;
};

const USER = name('IUser');
const PROFILE = name('IProfile');
const POST = name('IPost');
const TAG = name('ITag');
const COMMENT = name('IComment');
const CAT = name('ICat');

const User = defineTable(
  USER,
  {
    email: { type: 'string', required: true, unique: true },
    balance: { type: 'decimal', precision: 10, scale: 2 },
    visits: { type: 'bigint' },
    meta: { type: 'json' },
  },
  {
    relations: {
      profile: { hasOne: PROFILE, foreignKey: 'user' },
      posts: { hasMany: POST, foreignKey: 'author' },
    },
  },
);
const Profile = defineTable(PROFILE, {
  bio: { type: 'string' },
  user: { type: 'uuid', ref: USER, required: true, unique: true, onDelete: 'cascade' },
});
const Post = defineTable(
  POST,
  {
    title: { type: 'string', required: true },
    rank: { type: 'integer' },
    author: { type: 'uuid', ref: USER },
    tags: { type: 'array', of: 'uuid', ref: TAG },
  },
  { relations: { comments: { hasMany: COMMENT, foreignKey: 'post' } } },
);
const Tag = defineTable(
  TAG,
  { label: { type: 'string', required: true } },
  { relations: { posts: { hasMany: POST, foreignKey: 'tags' } } },
);
const Comment = defineTable(COMMENT, {
  body: { type: 'string', required: true },
  approved: { type: 'boolean', default: false },
  post: { type: 'uuid', ref: POST, required: true, onDelete: 'cascade' },
  by: { type: 'uuid', ref: USER },
});
const Cat = defineTable(
  CAT,
  {
    name: { type: 'string', required: true },
    parent: { type: 'integer', ref: CAT, onDelete: 'setNull' },
  },
  {
    id: 'serial',
    timestamps: false,
    relations: { children: { hasMany: CAT, foreignKey: 'parent' } },
  },
);

async function count(fn: () => Promise<unknown>): Promise<number[]> {
  const events: QueryEvent[] = [];
  const off = onQuery((e) => events.push(e));
  try {
    await fn();
  } finally {
    off();
  }
  return events.map((e) => e.statements);
}

describe.skipIf(!available)('defineTable relations — include', () => {
  let ann: Awaited<ReturnType<typeof User.create>>;
  let bo: Awaited<ReturnType<typeof User.create>>;
  let p1: Awaited<ReturnType<typeof Post.create>>;
  let p2: Awaited<ReturnType<typeof Post.create>>;
  let news: string, tech: string;

  beforeAll(async () => {
    setDbEngine('postgresql');
    await connectPostgres(PG_URL);
    // Sync in dependency order (first use would do it too).
    for (const m of [User, Tag, Post, Profile, Comment, Cat]) await m.sync();
    ann = await User.create({
      data: {
        email: 'ann@x.io',
        balance: '12.50',
        visits: 9007199254740993n,
        meta: { since: 2020, tags: ['a'] },
      },
    });
    bo = await User.create({ data: { email: 'bo@x.io' } });
    await Profile.create({ data: { bio: 'hi', user: ann.id } });
    news = (await Tag.create({ data: { label: 'news' } })).id;
    tech = (await Tag.create({ data: { label: 'tech' } })).id;
    p1 = await Post.create({ data: { title: 'p1', rank: 2, author: ann.id, tags: [tech, news] } });
    p2 = await Post.create({ data: { title: 'p2', rank: 1, author: ann.id, tags: [news] } });
    await Post.create({ data: { title: 'orphan' } });
    await Comment.createMany({
      data: [
        { body: 'c1', post: p1.id, by: bo.id, approved: true },
        { body: 'c2', post: p1.id, by: ann.id },
        { body: 'c3', post: p1.id, by: bo.id, approved: true },
        { body: 'c4', post: p2.id, by: bo.id },
      ],
    });
  });

  afterAll(async () => {
    const all = [...tables, `${tableNameFor(POST)}_tags`];
    for (const t of all) {
      await getPool()
        .query(`DROP TABLE IF EXISTS "${t}" CASCADE`)
        .catch(() => {});
    }
    await closePostgres();
  });

  it('loads a ref field as its record (1:n, the "one" side), null when unset', async () => {
    const posts = await Post.findMany({ include: { author: true }, orderBy: { title: 'asc' } });
    expect(
      posts.map((p) => [p.title, (p.author as { email?: string } | null)?.email ?? null]),
    ).toEqual([
      ['orphan', null],
      ['p1', 'ann@x.io'],
      ['p2', 'ann@x.io'],
    ]);
    // The included record is exactly what a direct read returns: decimal string, bigint, json, dates.
    expect(posts[1]!.author).toEqual(await User.findUnique({ where: { id: ann.id } }));
  });

  it('loads hasMany and hasOne back-relations (1:n and 1:1)', async () => {
    const users = await User.findMany({
      include: { profile: true, posts: { orderBy: { rank: 'asc' }, select: { title: true } } },
      orderBy: { email: 'asc' },
    });
    expect(users.map((u) => [u.email, u.profile, u.posts])).toEqual([
      [
        'ann@x.io',
        expect.objectContaining({ bio: 'hi', user: ann.id }),
        [{ title: 'p2' }, { title: 'p1' }],
      ],
      ['bo@x.io', null, []],
    ]);
  });

  it('loads many-to-many from both sides, in link order', async () => {
    const post = await Post.findUnique({ where: { id: p1.id }, include: { tags: true } });
    expect((post!.tags as { label: string }[]).map((t) => t.label)).toEqual(['tech', 'news']);
    const tag = await Tag.findUnique({
      where: { id: news },
      include: { posts: { orderBy: { title: 'asc' }, select: { title: true } } },
    });
    expect(tag!.posts).toEqual([{ title: 'p1' }, { title: 'p2' }]);
  });

  it('nests includes with where, orderBy, take, skip — in one statement', async () => {
    const args = {
      where: { id: ann.id },
      include: {
        posts: {
          orderBy: { title: 'asc' },
          include: {
            comments: {
              where: { approved: true },
              orderBy: { body: 'desc' },
              take: 1,
              include: { by: { select: { email: true } } },
            },
            tags: { select: { label: true } },
          },
        },
      },
    } as const;
    let user: Awaited<ReturnType<typeof User.findFirst>> = null;
    const statements = await count(async () => {
      user = await User.findFirst(args);
    });
    expect(statements).toEqual([1]);
    const posts = user!.posts as {
      title: string;
      comments: { body: string; by: { email: string } }[];
      tags: { label: string }[];
    }[];
    expect(
      posts.map((p) => [p.title, p.comments.map((c) => [c.body, c.by.email]), p.tags]),
    ).toEqual([
      ['p1', [['c3', 'bo@x.io']], [{ label: 'tech' }, { label: 'news' }]],
      ['p2', [], [{ label: 'news' }]],
    ]);

    const skipped = await Post.findUnique({
      where: { id: p1.id },
      include: { comments: { orderBy: { body: 'asc' }, skip: 1, take: 5, omit: { post: true } } },
    });
    expect((skipped!.comments as { body: string }[]).map((c) => c.body)).toEqual(['c2', 'c3']);
    expect(skipped!.comments as object[]).not.toContainEqual(
      expect.objectContaining({ post: p1.id }),
    );
  });

  it('handles self-relations both ways', async () => {
    const root = await Cat.create({ data: { name: 'root' } });
    const a = await Cat.create({ data: { name: 'a', parent: root.id } });
    await Cat.create({ data: { name: 'b', parent: root.id } });
    await Cat.create({ data: { name: 'a1', parent: a.id } });
    const tree = await Cat.findUnique({
      where: { id: root.id },
      include: {
        children: { orderBy: { name: 'asc' }, include: { children: true, parent: true } },
      },
    });
    const kids = tree!.children as {
      name: string;
      parent: { name: string };
      children: { name: string }[];
    }[];
    expect(kids.map((k) => [k.name, k.parent.name, k.children.map((c) => c.name)])).toEqual([
      ['a', 'root', ['a1']],
      ['b', 'root', []],
    ]);
  });

  it('works with select, distinct and in writes', async () => {
    const picked = await Post.findFirst({
      where: { id: p1.id },
      select: { title: true },
      include: { author: { select: { email: true } } },
    });
    expect(picked).toEqual({ title: 'p1', author: { email: 'ann@x.io' } });

    const distinct = await Comment.findMany({
      distinct: ['post'],
      orderBy: { body: 'asc' },
      include: { post: { select: { title: true } } },
    });
    expect(distinct.map((c) => (c.post as { title: string }).title).sort()).toEqual(['p1', 'p2']);

    const created = await Post.create({
      data: { title: 'p3', author: bo.id, tags: [tech] },
      include: { author: true, tags: { select: { label: true } } },
    });
    expect(created).toMatchObject({
      title: 'p3',
      author: { email: 'bo@x.io' },
      tags: [{ label: 'tech' }],
    });
    const updated = await Post.update({
      where: { id: created.id },
      data: { title: 'p3!' },
      include: { comments: true },
    });
    expect(updated).toMatchObject({ title: 'p3!', comments: [] });
    const deleted = await Post.delete({ where: { id: created.id }, include: { tags: true } });
    expect((deleted.tags as { label: string }[]).map((t) => t.label)).toEqual(['tech']);
    expect(await Post.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it('explains bad includes and relations', async () => {
    await expect(Post.findMany({ include: { nope: true } as never })).rejects.toThrow(
      'not a relation of',
    );
    await expect(Tag.findMany({ include: { label: true } as never })).rejects.toThrow(
      'not a relation of',
    );
    expect(() =>
      defineTable(
        'IX1',
        { a: { type: 'string' } },
        { relations: { a: { hasMany: POST, foreignKey: 'author' } } },
      ),
    ).toThrow('a field already has this name');
    expect(() =>
      defineTable('IX2', {}, { relations: { x: { foreignKey: 'author' } as never } }),
    ).toThrow('give either hasMany or hasOne');

    const OWNER = name('IOwner');
    const Owner = defineTable(
      OWNER,
      { email: { type: 'string' } },
      {
        relations: {
          pet: { hasOne: name('IPet'), foreignKey: 'owner' },
          bad: { hasMany: POST, foreignKey: 'title' },
        },
      },
    );
    defineTable(`IPet${s}`, { owner: { type: 'uuid', ref: OWNER } }); // not unique
    await expect(Owner.findMany({ include: { pet: true } })).rejects.toThrow(
      `hasOne needs IPet${s}.owner to be unique`,
    );
    await expect(Owner.findMany({ include: { bad: true } })).rejects.toThrow(
      `${POST}.title must be a ref to ${OWNER}`,
    );
  });
});
