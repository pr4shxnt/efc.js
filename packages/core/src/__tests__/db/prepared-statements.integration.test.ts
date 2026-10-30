import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { connectPostgres, closePostgres, getOrm, getPool } from '../../db/postgres.js';
import { invalidatePreparedStatements } from '../../db/prepared-statements.js';
import { setDbEngine } from '../../db/engine.js';
import { defineTable } from '../../db/table-model.js';

const URL = process.env['EFC_TEST_PG_URL'] ?? 'postgres://postgres@127.0.0.1:5433/efc_test';
const { default: pg } = await import('pg');
const probe = new pg.Client({ connectionString: URL, connectionTimeoutMillis: 1000 });
const available = await probe.connect().then(
  () => true,
  () => false,
);
await probe.end().catch(() => {});

async function named() {
  return (
    await getPool().query<{ name: string; statement: string }>(
      "select name, statement from pg_prepared_statements where name like 'efc_auto_%' order by name",
    )
  ).rows;
}

describe.skipIf(!available)('PostgreSQL prepared model statements', () => {
  it('reuses SQL shapes with different values, inside transactions, and falls back after the per-connection budget', async () => {
    await connectPostgres(URL, { max: 1, preparedStatements: { max: 2 } });
    try {
      const orm = getOrm();
      expect((await orm.execute(sql`select ${1}::int as n`)).rows[0].n).toBe(1);
      expect((await orm.execute(sql`select ${2}::int as n`)).rows[0].n).toBe(2);
      expect(await named()).toHaveLength(1);
      const name = (await named())[0]!.name;
      await expect(
        orm.transaction(async (tx: typeof orm) => {
          expect((await tx.execute(sql`select ${3}::int as n`)).rows[0].n).toBe(3);
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect((await named())[0]!.name).toBe(name);
      await orm.execute(sql`select ${'x'}::text as other`);
      await orm.execute(sql`select ${true}::boolean as third`);
      expect(await named()).toHaveLength(2);
      expect((await orm.execute(sql`select ${4}::int as n`)).rows[0].n).toBe(4);
      invalidatePreparedStatements(getPool());
      // No DEALLOCATE/eviction under concurrent traffic; old names consume the lifetime
      // budget, so invalidated/new shapes now run unnamed rather than growing it.
      await orm.execute(sql`select ${5}::int as n`);
      expect(await named()).toHaveLength(2);
    } finally {
      await closePostgres();
    }
  });

  it('allows disabling preparation for poolers and keeps native db.query unchanged', async () => {
    await connectPostgres(URL, { max: 1, preparedStatements: false });
    try {
      await getOrm().execute(sql`select ${1}::int as n`);
      await getPool().query({ text: 'select $1::int as n', values: [2] });
      expect(await named()).toHaveLength(0);
    } finally {
      await closePostgres();
    }
  });

  it('invalidates cached result types after an EFC schema sync', async () => {
    await connectPostgres(URL, { max: 1 });
    setDbEngine('postgresql');
    const name = 'PreparedSync' + Math.random().toString(36).slice(2);
    const table = 'prepared_sync_' + Math.random().toString(36).slice(2);
    const V1 = defineTable(name, { value: { type: 'string' } }, { collection: table });
    try {
      await V1.sync();
      const query = sql.raw(`select * from "${table}"`);
      await getOrm().execute(query);
      const V2 = defineTable(
        name + 'V2',
        { value: { type: 'string' }, extra: { type: 'integer' } },
        { collection: table },
      );
      await V2.sync();
      const result = await getOrm().execute(query);
      expect(result.fields.map((field: { name: string }) => field.name)).toContain('extra');
      expect((await named()).filter((row) => row.statement.includes(`"${table}"`))).toHaveLength(2);
    } finally {
      await V1.drop();
      await closePostgres();
    }
  });
});
