import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { defineTable } from '../../db/table-model.js';
import { setDbEngine } from '../../db/engine.js';
import { connectPostgres, closePostgres, getPool } from '../../db/postgres.js';
import { tableNameFor } from '../../db/pg-table.js';
import { ModelValidationError } from '../../db/schema.js';
import { onQuery, type QueryEvent } from '../../db/query-log.js';

// defineTable relations, M3c: relation filters (some / every / none, is / isNot) as EXISTS
// subqueries, and nested writes (connect, create, connectOrCreate, disconnect, set, delete)
// in one transaction — on own refs, many-to-many fields and back-relations. Follows
// Prisma's "relation queries" guide. Skips without PostgreSQL.
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

const USER = name('NUser');
const PROFILE = name('NProfile');
const POST = name('NPost');
const TAG = name('NTag');
const COMMENT = name('NComment');

const User = defineTable(
  USER,
  { email: { type: 'string', required: true, unique: true } },
  {
    relations: {
      posts: { hasMany: POST, foreignKey: 'author' },
      profile: { hasOne: PROFILE, foreignKey: 'user' },
    },
  },
);
const Profile = defineTable(PROFILE, {
  bio: { type: 'string' },
  user: { type: 'uuid', ref: USER, unique: true, onDelete: 'cascade' },
});
const Post = defineTable(
  POST,
  {
    title: { type: 'string', required: true, unique: true },
    author: { type: 'uuid', ref: USER },
    tags: { type: 'array', of: 'uuid', ref: TAG },
  },
  { relations: { comments: { hasMany: COMMENT, foreignKey: 'post' } } },
);
const Tag = defineTable(
  TAG,
  { label: { type: 'string', required: true, unique: true } },
  { relations: { posts: { hasMany: POST, foreignKey: 'tags' } } },
);
const Comment = defineTable(COMMENT, {
  body: { type: 'string', required: true },
  approved: { type: 'boolean', default: false },
  post: { type: 'uuid', ref: POST, required: true, onDelete: 'cascade' },
});

const emails = (rows: { email: string }[]) => rows.map((r) => r.email).sort();
const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();
const labels = (rows: { label: string }[]) => rows.map((r) => r.label);

async function statements(fn: () => Promise<unknown>): Promise<number[]> {
  const events: QueryEvent[] = [];
  const off = onQuery((e) => events.push(e));
  try {
    await fn();
  } finally {
    off();
  }
  return events.map((e) => e.statements);
}

async function reset() {
  for (const m of [Comment, Profile, Post, Tag, User]) await m.deleteMany();
}

describe.skipIf(!available)('defineTable relations — filters and nested writes', () => {
  beforeAll(async () => {
    setDbEngine('postgresql');
    await connectPostgres(PG_URL);
    for (const m of [User, Tag, Post, Profile, Comment]) await m.sync();
  });

  afterAll(async () => {
    for (const t of [...tables, `${tableNameFor(POST)}_tags`]) {
      await getPool()
        .query(`DROP TABLE IF EXISTS "${t}" CASCADE`)
        .catch(() => {});
    }
    await closePostgres();
  });

  describe('relation filters', () => {
    beforeAll(async () => {
      await reset();
      const [ann, bo] = await User.createManyAndReturn({
        data: [{ email: 'ann@x' }, { email: 'bo@x' }, { email: 'cy@x' }],
      });
      await Profile.create({ data: { bio: 'writer', user: ann!.id } });
      const [news, tech] = await Tag.createManyAndReturn({
        data: [{ label: 'news' }, { label: 'tech' }, { label: 'idle' }],
      });
      const p1 = await Post.create({
        data: { title: 'p1', author: ann!.id, tags: [news!.id, tech!.id] },
      });
      await Post.create({ data: { title: 'p2', author: ann!.id, tags: [tech!.id] } });
      const p3 = await Post.create({ data: { title: 'p3', author: bo!.id, tags: [news!.id] } });
      await Post.create({ data: { title: 'p4' } });
      await Comment.createMany({
        data: [
          { body: 'ok', post: p1.id, approved: true },
          { body: 'spam', post: p3.id },
        ],
      });
    });

    it('some / none / every on a hasMany back-relation', async () => {
      expect(emails(await User.findMany({ where: { posts: { some: { title: 'p3' } } } }))).toEqual([
        'bo@x',
      ]);
      expect(emails(await User.findMany({ where: { posts: { some: {} } } }))).toEqual([
        'ann@x',
        'bo@x',
      ]);
      expect(emails(await User.findMany({ where: { posts: { none: {} } } }))).toEqual(['cy@x']);
      // every holds vacuously for users without posts.
      expect(
        emails(
          await User.findMany({ where: { posts: { every: { title: { in: ['p1', 'p2'] } } } } }),
        ),
      ).toEqual(['ann@x', 'cy@x']);
    });

    it('is / isNot on own refs and hasOne', async () => {
      expect(
        titles(await Post.findMany({ where: { author: { is: { email: 'ann@x' } } } })),
      ).toEqual(['p1', 'p2']);
      expect(
        titles(await Post.findMany({ where: { author: { isNot: { email: 'ann@x' } } } })),
      ).toEqual(['p3', 'p4']);
      expect(titles(await Post.findMany({ where: { author: { is: null } } }))).toEqual(['p4']);
      expect(emails(await User.findMany({ where: { profile: { isNot: null } } }))).toEqual([
        'ann@x',
      ]);
      expect(
        emails(await User.findMany({ where: { profile: { is: { bio: 'writer' } } } })),
      ).toEqual(['ann@x']);
      expect(emails(await User.findMany({ where: { profile: { is: null } } }))).toEqual([
        'bo@x',
        'cy@x',
      ]);
    });

    it('many-to-many from both sides, alongside the list filters', async () => {
      expect(titles(await Post.findMany({ where: { tags: { some: { label: 'news' } } } }))).toEqual(
        ['p1', 'p3'],
      );
      expect(
        titles(await Post.findMany({ where: { tags: { every: { label: 'tech' } } } })),
      ).toEqual(['p2', 'p4']);
      expect(titles(await Post.findMany({ where: { tags: { none: { label: 'tech' } } } }))).toEqual(
        ['p3', 'p4'],
      );
      expect(labels(await Tag.findMany({ where: { posts: { none: {} } } }))).toEqual(['idle']);
      expect(
        labels(
          await Tag.findMany({ where: { posts: { some: { author: { is: { email: 'bo@x' } } } } } }),
        ),
      ).toEqual(['news']);
      const tech = await Tag.findUnique({ where: { label: 'tech' } });
      expect(titles(await Post.findMany({ where: { tags: { has: tech!.id } } }))).toEqual([
        'p1',
        'p2',
      ]);
    });

    it('nests, combines and works in every operation that takes where — one statement', async () => {
      const deep = { posts: { some: { comments: { some: { approved: true } } } } };
      let found: { email: string }[] = [];
      expect(await statements(async () => (found = await User.findMany({ where: deep })))).toEqual([
        1,
      ]);
      expect(emails(found)).toEqual(['ann@x']);
      expect(
        emails(
          await User.findMany({
            where: { OR: [deep, { email: 'cy@x' }], NOT: { profile: { is: null } } },
          }),
        ),
      ).toEqual(['ann@x']);
      expect(await User.count({ where: { posts: { some: {} } } })).toBe(2);

      const withSpam = await User.findMany({
        where: { email: { in: ['ann@x', 'bo@x'] } },
        orderBy: { email: 'asc' },
        include: {
          posts: { where: { comments: { some: { body: 'spam' } } }, select: { title: true } },
        },
      });
      expect(withSpam.map((u) => u.posts)).toEqual([[], [{ title: 'p3' }]]);

      expect(
        await Comment.updateMany({
          where: { post: { is: { author: { is: { email: 'bo@x' } } } } },
          data: { approved: true },
        }),
      ).toEqual({ count: 1 });
      expect(
        await Post.deleteMany({ where: { author: { is: null }, comments: { none: {} } } }),
      ).toEqual({ count: 1 });
      expect(await Post.findUnique({ where: { title: 'p4' } })).toBeNull();
    });

    it('asks for some / every / none on a back-relation', async () => {
      await expect(User.findMany({ where: { posts: { title: 'p1' } } as never })).rejects.toThrow(
        'filter a relation with some / every / none',
      );
    });
  });

  describe('nested writes', () => {
    beforeEach(reset);

    it('creates with connect, create and connectOrCreate on refs and many-to-many', async () => {
      await User.create({ data: { email: 'ann@x' } });
      const old = await Tag.create({ data: { label: 'old' } });
      const post = await Post.create({
        data: {
          title: 'hello',
          author: { connect: { email: 'ann@x' } },
          tags: {
            connect: [old.id],
            create: [{ label: 'fresh' }],
            connectOrCreate: [
              { where: { label: 'old' }, create: { label: 'old' } },
              { where: { label: 'new' }, create: { label: 'new' } },
            ],
          },
        },
        include: { author: true, tags: { select: { label: true } } },
      });
      expect((post.author as { email: string }).email).toBe('ann@x');
      expect(post.tags).toEqual([{ label: 'old' }, { label: 'new' }, { label: 'fresh' }]);
      expect(await Tag.count()).toBe(3);

      const byCreate = await Post.create({
        data: { title: 'two', author: { create: { email: 'new@x' } } },
        include: { author: true },
      });
      expect((byCreate.author as { email: string }).email).toBe('new@x');
    });

    it('creates children through back-relations, in one transaction', async () => {
      const user = await User.create({
        data: {
          email: 'ann@x',
          profile: { create: { bio: 'hi' } },
          posts: {
            create: [
              { title: 'a', comments: { create: [{ body: 'first' }] } },
              { title: 'b', tags: { create: [{ label: 'x' }] } },
            ],
          },
        },
        include: {
          profile: true,
          posts: { orderBy: { title: 'asc' }, include: { comments: true, tags: true } },
        },
      });
      const posts = user.posts as {
        title: string;
        comments: { body: string }[];
        tags: { label: string }[];
      }[];
      expect((user.profile as { bio: string }).bio).toBe('hi');
      expect(
        posts.map((p) => [p.title, p.comments.map((c) => c.body), p.tags.map((t) => t.label)]),
      ).toEqual([
        ['a', ['first'], []],
        ['b', [], ['x']],
      ]);

      // A failing step anywhere rolls the whole write back.
      const err = await User.create({
        data: { email: 'bo@x', posts: { create: [{ title: 'c' }], connect: [{ title: 'nope' }] } },
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ModelValidationError);
      expect((err as ModelValidationError).issues).toEqual([
        { path: 'posts', message: `no ${POST} matches {"title":"nope"}` },
      ]);
      expect(await User.findUnique({ where: { email: 'bo@x' } })).toBeNull();
      expect(await Post.findUnique({ where: { title: 'c' } })).toBeNull();
    });

    it('updates own refs and many-to-many with connect / disconnect / set / push / pull', async () => {
      const [a, b, c] = await Tag.createManyAndReturn({
        data: [{ label: 'a' }, { label: 'b' }, { label: 'c' }],
      });
      await User.createMany({ data: [{ email: 'ann@x' }, { email: 'bo@x' }] });
      const p = await Post.create({
        data: { title: 'p', author: { connect: { email: 'ann@x' } }, tags: [a!.id] },
      });

      const tagsOf = async () =>
        labels(
          (await Post.findUnique({ where: { id: p.id }, include: { tags: true } }))!.tags as {
            label: string;
          }[],
        );
      await Post.update({
        where: { id: p.id },
        data: { tags: { connect: [{ label: 'b' }, c!.id] } },
      });
      expect(await tagsOf()).toEqual(['a', 'b', 'c']);
      await Post.update({ where: { id: p.id }, data: { tags: { disconnect: [{ label: 'a' }] } } });
      expect(await tagsOf()).toEqual(['b', 'c']);
      await Post.update({
        where: { id: p.id },
        data: { tags: { set: [{ label: 'c' }, { label: 'a' }] } },
      });
      expect(await tagsOf()).toEqual(['c', 'a']);
      await Post.update({ where: { id: p.id }, data: { tags: { pull: c!.id } } });
      expect(await tagsOf()).toEqual(['a']);
      await Post.update({ where: { id: p.id }, data: { tags: { push: [b!.id] } } });
      expect(await tagsOf()).toEqual(['a', 'b']);

      const moved = await Post.update({
        where: { id: p.id },
        data: { author: { connect: { email: 'bo@x' } } },
        include: { author: true },
      });
      expect((moved.author as { email: string }).email).toBe('bo@x');
      const cleared = await Post.update({
        where: { id: p.id },
        data: { author: { disconnect: true } },
      });
      expect(cleared).not.toHaveProperty('author');
    });

    it('updates back-relations: connect, disconnect, set, delete, deleteMany, hasOne', async () => {
      const ann = await User.create({ data: { email: 'ann@x' } });
      await Post.createMany({
        data: [{ title: 'p1' }, { title: 'p2' }, { title: 'p3' }, { title: 'p4' }],
      });
      const postsOf = async () =>
        titles(
          (await User.findUnique({ where: { id: ann.id }, include: { posts: true } }))!.posts as {
            title: string;
          }[],
        );

      await User.update({
        where: { id: ann.id },
        data: { posts: { connect: [{ title: 'p1' }, { title: 'p2' }] } },
      });
      expect(await postsOf()).toEqual(['p1', 'p2']);
      await User.update({
        where: { id: ann.id },
        data: { posts: { disconnect: [{ title: 'p1' }] } },
      });
      expect(await postsOf()).toEqual(['p2']);
      await User.update({
        where: { id: ann.id },
        data: { posts: { set: [{ title: 'p3' }, { title: 'p4' }] } },
      });
      expect(await postsOf()).toEqual(['p3', 'p4']);
      expect(await Post.findUnique({ where: { title: 'p2' } })).not.toHaveProperty('author');
      await User.update({ where: { id: ann.id }, data: { posts: { delete: [{ title: 'p3' }] } } });
      expect(await Post.findUnique({ where: { title: 'p3' } })).toBeNull();
      await User.update({
        where: { id: ann.id },
        data: { posts: { create: [{ title: 'p5' }], deleteMany: { title: 'p4' } } },
      });
      expect(await postsOf()).toEqual(['p5']);

      // hasOne: create replaces (the old one is unlinked), disconnect, delete.
      await User.update({ where: { id: ann.id }, data: { profile: { create: { bio: 'v1' } } } });
      await User.update({ where: { id: ann.id }, data: { profile: { create: { bio: 'v2' } } } });
      const profiles = await Profile.findMany({ orderBy: { bio: 'asc' } });
      expect(profiles.map((p) => [p.bio, p.user ?? null])).toEqual([
        ['v1', null],
        ['v2', ann.id],
      ]);
      await User.update({ where: { id: ann.id }, data: { profile: { delete: true } } });
      expect(await Profile.count()).toBe(1);
    });

    it('many-to-many back-relations and upsert', async () => {
      const tag = await Tag.create({
        data: { label: 't', posts: { create: [{ title: 'via tag' }] } },
      });
      await Post.create({ data: { title: 'other' } });
      await Tag.update({
        where: { id: tag.id },
        data: { posts: { connect: [{ title: 'other' }] } },
      });
      const postsOfTag = async () =>
        titles(
          (await Tag.findUnique({ where: { id: tag.id }, include: { posts: true } }))!.posts as {
            title: string;
          }[],
        );
      expect(await postsOfTag()).toEqual(['other', 'via tag']);
      await Tag.update({
        where: { id: tag.id },
        data: { posts: { disconnect: [{ title: 'via tag' }] } },
      });
      expect(await postsOfTag()).toEqual(['other']);
      expect((await Post.findUnique({ where: { title: 'via tag' } }))!.tags).toEqual([]);

      const created = await Post.upsert({
        where: { title: 'u' },
        create: { title: 'u', author: { create: { email: 'u@x' } } },
        update: { tags: { connect: [{ label: 't' }] } },
        include: { author: true, tags: true },
      });
      expect((created.author as { email: string }).email).toBe('u@x');
      const updated = await Post.upsert({
        where: { title: 'u' },
        create: { title: 'u' },
        update: { tags: { connect: [{ label: 't' }] } },
        include: { tags: { select: { label: true } } },
      });
      expect(updated).toMatchObject({ id: created.id, tags: [{ label: 't' }] });
    });

    it('explains what nested writes don’t take', async () => {
      await expect(
        Post.createMany({ data: [{ title: 'x', author: { create: { email: 'z@x' } } }] as never }),
      ).rejects.toThrow("createMany doesn't take nested writes — use create");
      await expect(
        User.updateMany({ data: { posts: { create: [{ title: 'y' }] } } as never }),
      ).rejects.toThrow("updateMany doesn't take nested writes — use update");
      await expect(
        Post.create({ data: { title: 'z', author: { set: 'x' } } as never }),
      ).rejects.toThrow('"set" isn\'t a nested write here');
      await expect(
        Post.create({ data: { title: 'z', author: { disconnect: true } } as never }),
      ).rejects.toThrow('disconnect only applies to updates');
    });
  });
});
