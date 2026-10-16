import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { stripVTControlCharacters as strip } from 'node:util';
import { defineTable } from '../../db/table-model.js';
import { defineModel } from '../../db/model.js';
import { setDbEngine } from '../../db/engine.js';
import { connectPostgres, closePostgres, getPool } from '../../db/postgres.js';
import { tableNameFor } from '../../db/pg-table.js';
import { ModelValidationError } from '../../db/schema.js';
import { HttpError } from '../../errors.js';
import { configureLogger } from '../../logger.js';

// defineTable relations, M3a: `ref` fields are real foreign keys with referential actions,
// added NOT VALID and validated after the sync. Follows Prisma's referential-actions guide
// (Cascade, Restrict, SetNull) plus self- and mutual relations. Skips without PostgreSQL.
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

const AUTHOR = name('RAuthor');
const POST = name('RPost');
const CAT = name('RCat');

const Author = defineTable(AUTHOR, { name: { type: 'string', required: true } });
const Post = defineTable(POST, {
  title: { type: 'string', required: true },
  author: { type: 'uuid', ref: AUTHOR, required: true, onDelete: 'cascade' },
  editor: { type: 'objectId', ref: AUTHOR, onDelete: 'setNull' },
  reviewer: { type: 'uuid', ref: AUTHOR }, // restrict (default)
});
const Cat = defineTable(
  CAT,
  {
    name: { type: 'string', required: true },
    parent: { type: 'integer', ref: CAT, onDelete: 'setNull' },
  },
  { id: 'serial' },
);

interface LiveFk {
  name: string;
  column: string;
  target: string;
  action: string;
  valid: boolean;
}

async function foreignKeysOf(table: string): Promise<LiveFk[]> {
  const { rows } = await getPool().query<LiveFk>(
    `SELECT con.conname AS name, a.attname AS column, ft.relname AS target,
            con.confdeltype AS action, con.convalidated AS valid
     FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
     JOIN pg_class ft ON ft.oid = con.confrelid
     JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
     WHERE c.relname = $1 AND con.contype = 'f' ORDER BY a.attname`,
    [table],
  );
  return rows;
}

async function indexesOf(table: string): Promise<string[]> {
  const { rows } = await getPool().query<{ name: string }>(
    'SELECT indexname AS name FROM pg_indexes WHERE tablename = $1 ORDER BY 1',
    [table],
  );
  return rows.map((r) => r.name);
}

async function rejection(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a rejection');
}

describe.skipIf(!available)('defineTable relations — foreign keys', () => {
  const posts = tableNameFor(POST);
  const authors = tableNameFor(AUTHOR);

  beforeAll(async () => {
    setDbEngine('postgresql');
    await connectPostgres(PG_URL);
  });

  afterAll(async () => {
    for (const t of created) {
      await getPool()
        .query(`DROP TABLE IF EXISTS "${t}" CASCADE`)
        .catch(() => {});
    }
    await closePostgres();
  });

  it('syncs the target table first and adds validated, indexed foreign keys', async () => {
    // Nothing has touched Author yet: syncing Post must create it to reference it.
    await Post.sync();
    expect(await foreignKeysOf(posts)).toEqual([
      { name: `${posts}_author_fkey`, column: 'author', target: authors, action: 'c', valid: true },
      { name: `${posts}_editor_fkey`, column: 'editor', target: authors, action: 'n', valid: true },
      {
        name: `${posts}_reviewer_fkey`,
        column: 'reviewer',
        target: authors,
        action: 'r',
        valid: true,
      },
    ]);
    expect(await indexesOf(posts)).toEqual(
      expect.arrayContaining([
        `${posts}_author_idx`,
        `${posts}_editor_idx`,
        `${posts}_reviewer_idx`,
      ]),
    );
    expect(await Post.sync({ dryRun: true })).toEqual([]);
  });

  it('rejects a reference to a missing record with a 400 on the field', async () => {
    const err = await rejection(
      Post.create({ data: { title: 'x', author: '00000000-0000-4000-8000-000000000000' } }),
    );
    expect(err).toBeInstanceOf(ModelValidationError);
    expect((err as ModelValidationError).issues).toEqual([
      { path: 'author', message: `${AUTHOR} not found` },
    ]);
  });

  it('cascade deletes, setNull clears, restrict refuses with a 409', async () => {
    const ann = await Author.create({ data: { name: 'Ann' } });
    const bo = await Author.create({ data: { name: 'Bo' } });
    const cy = await Author.create({ data: { name: 'Cy' } });
    const p1 = await Post.create({ data: { title: 'by Ann', author: ann.id, editor: bo.id } });
    const p2 = await Post.create({ data: { title: 'by Bo', author: bo.id, reviewer: cy.id } });

    const err = await rejection(Author.delete({ where: { id: cy.id } }));
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).statusCode).toBe(409);
    expect(err.message).toBe(
      `${AUTHOR} is still referenced by ${POST} — delete or reassign those records first`,
    );
    expect(await Author.findUnique({ where: { id: cy.id } })).not.toBeNull();

    // Bo edits p1 (setNull) and wrote p2 (cascade).
    await Author.delete({ where: { id: bo.id } });
    // Records omit null fields, as on MongoDB.
    expect(await Post.findUnique({ where: { id: p1.id } })).not.toHaveProperty('editor');
    expect(await Post.findUnique({ where: { id: p2.id } })).toBeNull();

    await Author.deleteMany({ where: { id: ann.id } });
    expect(await Post.findUnique({ where: { id: p1.id } })).toBeNull();
  });

  it('supports self-relations on serial ids', async () => {
    const root = await Cat.create({ data: { name: 'root' } });
    const child = await Cat.create({ data: { name: 'child', parent: root.id } });
    expect(typeof child.parent).toBe('number');
    await Cat.delete({ where: { id: root.id } });
    expect(await Cat.findUnique({ where: { id: child.id } })).not.toHaveProperty('parent');
    expect(await foreignKeysOf(tableNameFor(CAT))).toMatchObject([
      { column: 'parent', target: tableNameFor(CAT), action: 'n' },
    ]);
  });

  it('syncs mutual references without deadlocking, adding both keys', async () => {
    const A = name('RMutA');
    const B = name('RMutB');
    const ModelA = defineTable(A, { b: { type: 'uuid', ref: B } });
    defineTable(B, { a: { type: 'uuid', ref: A } });
    await ModelA.sync();
    expect(await foreignKeysOf(tableNameFor(A))).toMatchObject([{ target: tableNameFor(B) }]);
    // B's key to A waits for A's table: added by a second pass right after.
    await vi.waitFor(
      async () =>
        expect(await foreignKeysOf(tableNameFor(B))).toMatchObject([
          { target: tableNameFor(A), valid: true },
        ]),
      { timeout: 3000 },
    );
  });

  it('adds keys to tables holding orphans NOT VALID, warns, and validates once fixed', async () => {
    const O = name('ROrphan');
    const table = tableNameFor(O);
    await getPool().query(`CREATE TABLE "${table}" (id uuid PRIMARY KEY, owner uuid)`);
    await getPool().query(
      `INSERT INTO "${table}" VALUES (gen_random_uuid(), '00000000-0000-4000-8000-000000000001')`,
    );
    const Orphan = defineTable(O, { owner: { type: 'uuid', ref: AUTHOR } });

    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      output += strip(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    configureLogger({ pretty: true });
    try {
      await Orphan.sync();
    } finally {
      vi.restoreAllMocks();
      configureLogger(undefined);
    }
    expect(output).toMatch(`${O}.owner: 1 row(s) reference a missing ${AUTHOR}`);
    expect(await foreignKeysOf(table)).toMatchObject([{ column: 'owner', valid: false }]);

    // Enforced for new writes all the same.
    await expect(
      Orphan.create({ data: { owner: '00000000-0000-4000-8000-000000000002' } }),
    ).rejects.toBeInstanceOf(ModelValidationError);

    await Orphan.deleteMany();
    expect(await Orphan.sync()).toEqual([
      `ALTER TABLE "${table}" VALIDATE CONSTRAINT "${table}_owner_fkey"`,
    ]);
    expect(await foreignKeysOf(table)).toMatchObject([{ valid: true }]);
  });

  it('replaces a key whose action changed and drops one whose ref was removed', async () => {
    const L = name('RLink');
    const table = tableNameFor(L);
    await defineTable(L, { owner: { type: 'uuid', ref: AUTHOR } }).sync();
    expect(await foreignKeysOf(table)).toMatchObject([{ action: 'r' }]);

    await defineTable(L, { owner: { type: 'uuid', ref: AUTHOR, onDelete: 'cascade' } }).sync();
    expect(await foreignKeysOf(table)).toMatchObject([{ action: 'c' }]);

    await defineTable(L, { owner: { type: 'uuid' } }).sync();
    expect(await foreignKeysOf(table)).toEqual([]);
    expect(await indexesOf(table)).toEqual([`${table}_pkey`]);
  });

  it('leaves foreign keys on columns the model does not declare alone', async () => {
    const K = name('RKeep');
    const table = tableNameFor(K);
    await getPool().query(
      `CREATE TABLE "${table}" (id uuid PRIMARY KEY, legacy uuid REFERENCES "${authors}" (id))`,
    );
    await defineTable(K, { note: { type: 'string' } }).sync();
    expect(await foreignKeysOf(table)).toMatchObject([{ column: 'legacy' }]);
  });

  it('explains a ref whose type does not match the target id', async () => {
    const Bad = defineTable(name('RBad'), { cat: { type: 'uuid', ref: CAT } });
    await expect(Bad.sync()).rejects.toThrow(
      `references ${CAT}, whose id is integer (id: 'serial') — declare it { type: 'integer', ref: '${CAT}' }`,
    );
    const Lost = defineTable(name('RLost'), { x: { type: 'uuid', ref: 'Nope' } });
    await expect(Lost.findMany()).rejects.toThrow(`references "Nope", which is not defined`);
  });

  it('rejects invalid relation options at definition time', () => {
    expect(() => defineTable('RX1', { a: { type: 'uuid', onDelete: 'cascade' } })).toThrow(
      `'onDelete' needs 'ref'`,
    );
    expect(() =>
      defineTable('RX2', { a: { type: 'uuid', ref: AUTHOR, required: true, onDelete: 'setNull' } }),
    ).toThrow(`onDelete: 'setNull' can't clear a required field`);
    expect(() =>
      defineTable('RX3', { a: { type: 'uuid', ref: AUTHOR, onDelete: 'nullify' as never } }),
    ).toThrow(`onDelete must be 'restrict', 'cascade' or 'setNull'`);
    expect(() => defineTable('RX4', { a: { type: 'string', ref: AUTHOR } })).toThrow(
      `'ref' needs an id type`,
    );
    expect(() => defineTable('RX5', { meta: { owner: { type: 'uuid', ref: AUTHOR } } })).toThrow(
      `'ref' only applies to top-level fields`,
    );
    expect(() =>
      defineModel('RX6', { a: { type: 'objectId', onDelete: 'cascade' } as never }),
    ).toThrow(`'onDelete' is a defineTable option`);
  });

  it('keeps defineModel portable: refs stay plain columns', async () => {
    const M = name('RPortable');
    const Portable = defineModel(M, { owner: { type: 'objectId', ref: AUTHOR } });
    await Portable.sync();
    expect(await foreignKeysOf(tableNameFor(M))).toEqual([]);
    const rec = await Portable.create({ owner: '00000000-0000-4000-8000-000000000003' });
    expect(rec.owner).toBe('00000000-0000-4000-8000-000000000003');
  });
});
