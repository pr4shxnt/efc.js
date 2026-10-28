import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { stripVTControlCharacters as strip } from 'node:util';
import { defineModel } from '../../db/model.js';
import { defineTable } from '../../db/table-model.js';
import { setDbEngine } from '../../db/engine.js';
import { connectPostgres, closePostgres } from '../../db/postgres.js';
import { transaction } from '../../db/transaction.js';
import { configureQueryLog, onQuery, type QueryEvent } from '../../db/query-log.js';
import { configureLogger } from '../../logger.js';
import { runWithContext } from '../../context.js';
import type { DatabaseEngine } from '../../types.js';

// CI points every test file at one database (EFC_TEST_MONGO_URL); files that drop theirs need
// their own, or they wipe each other's data mid-run. Keep the server, use this file's name.
const perFileDb = (url: string | undefined, db: string) =>
  url ? url.replace(/\/[^/?]*(\?|$)/, `/${db}$1`) : `mongodb://127.0.0.1:27017/${db}`;

// Query logging (logging.queries): one event per model operation with its statement
// count, slow-query warnings and the N+1 detector, on both engines. Skips an engine whose
// database isn't reachable (CI provides both).
const MONGO_URL = perFileDb(process.env['EFC_TEST_MONGO_URL'], 'efc_querylog_test');
const PG_URL = process.env['EFC_TEST_PG_URL'] ?? 'postgres://postgres@127.0.0.1:5433/efc_test';

async function reachableMongo(url: string): Promise<boolean> {
  const conn = mongoose.createConnection(url, { serverSelectionTimeoutMS: 1500 });
  try {
    await conn.asPromise();
    return true;
  } catch {
    return false;
  } finally {
    await conn.close().catch(() => {});
  }
}

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

const available: Record<DatabaseEngine, boolean> = {
  mongodb: await reachableMongo(MONGO_URL),
  postgresql: await reachablePg(PG_URL),
};

/** Collects query events (and captured pretty log output) while `fn` runs. */
async function capture(fn: () => Promise<unknown>) {
  const events: QueryEvent[] = [];
  const off = onQuery((e) => events.push(e));
  try {
    await fn();
  } finally {
    off();
  }
  return events;
}

function captureStdout() {
  let output = '';
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    output += strip(String(chunk));
    return true;
  }) as typeof process.stdout.write);
  return () => output;
}

afterEach(() => {
  vi.restoreAllMocks();
  configureQueryLog(undefined);
  configureLogger(undefined);
});

for (const engine of ['mongodb', 'postgresql'] as const) {
  describe.skipIf(!available[engine])(`query logging — defineModel on ${engine}`, () => {
    const s = `${engine === 'mongodb' ? 'M' : 'P'}${Math.random().toString(36).slice(2, 7)}`;
    const Writer = defineModel(`QWriter${s}`, { name: { type: 'string', required: true } });
    const Note = defineModel(`QNote${s}`, {
      text: { type: 'string', required: true },
      writer: { type: 'objectId', ref: `QWriter${s}` },
    });

    beforeAll(async () => {
      setDbEngine(engine);
      if (engine === 'mongodb') await mongoose.connect(MONGO_URL);
      else await connectPostgres(PG_URL);
    });

    afterAll(async () => {
      await Note.drop().catch(() => {});
      await Writer.drop().catch(() => {});
      if (engine === 'mongodb') await mongoose.disconnect();
      else await closePostgres();
    });

    it('reports each operation with one statement, not counting first-use sync', async () => {
      const events = await capture(async () => {
        const w = await Writer.create({ name: 'Ann' });
        await Writer.findById(w.id);
        await Writer.count();
      });
      expect(events.map((e) => [e.model, e.op, e.statements])).toEqual([
        [`QWriter${s}`, 'create', 1],
        [`QWriter${s}`, 'findById', 1],
        [`QWriter${s}`, 'count', 1],
      ]);
      for (const e of events) expect(e.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("counts populate's statements in the outer call", async () => {
      const w = await Writer.create({ name: 'Bo' });
      const n = await Note.create({ text: 'hi', writer: w.id });
      const events = await capture(() => Note.findById(n.id, { populate: ['writer'] }));
      // PostgreSQL populates through the ref's model (its own, nested event); MongoDB
      // through mongoose's populate, inside the one operation.
      expect(events.map((e) => [e.model, e.op, e.statements])).toEqual([
        ...(engine === 'postgresql' ? [[`QWriter${s}`, 'find', 1]] : []),
        [`QNote${s}`, 'findById', 2],
      ]);
    });

    it('reports failures with the error', async () => {
      const events = await capture(() => Writer.create({} as never).catch(() => {}));
      expect(events).toHaveLength(1);
      expect(events[0]!.error).toMatch(/name/);
    });

    it('carries the request ID', async () => {
      const events = await capture(() =>
        runWithContext({ requestId: 'req-42' }, () => Writer.count()),
      );
      expect(events[0]!.reqId).toBe('req-42');
    });
  });
}

describe.skipIf(!available.postgresql)('query logging — defineTable', () => {
  const s = Math.random().toString(36).slice(2, 7);
  const Item = defineTable(`QItem${s}`, {
    sku: { type: 'string', required: true, unique: true },
    qty: { type: 'integer', default: 0 },
  });

  beforeAll(async () => {
    setDbEngine('postgresql');
    await connectPostgres(PG_URL);
  });

  afterAll(async () => {
    await Item.drop().catch(() => {});
    await closePostgres();
  });

  it('issues one statement per call, inside transactions too', async () => {
    const events = await capture(async () => {
      await Item.create({ data: { sku: 'a' } });
      await Item.upsert({ where: { sku: 'a' }, create: { sku: 'a' }, update: { qty: 2 } });
      await Item.findMany({ where: { qty: { gt: 0 } }, orderBy: { sku: 'asc' }, take: 5 });
      await transaction(async () => {
        await Item.create({ data: { sku: 'b' } });
        await Item.updateMany({ where: {}, data: { qty: 3 } });
      });
      await Item.aggregate({ _sum: { qty: true } });
    });
    expect(events.map((e) => [e.op, e.statements])).toEqual([
      ['create', 1],
      ['upsert', 1],
      ['findMany', 1],
      ['create', 1],
      ['updateMany', 1],
      ['aggregate', 1],
    ]);
  });

  it('logs every operation with queries: true', async () => {
    const output = captureStdout();
    configureLogger({ pretty: true });
    configureQueryLog({ queries: true });
    await Item.count();
    expect(output()).toMatch(new RegExp(`INFO .*QItem${s}\\.count [\\d.]+ms .*statements=1`));
  });

  it('logs only slow operations with an object config', async () => {
    const output = captureStdout();
    configureLogger({ pretty: true });
    configureQueryLog({ queries: { slowMs: 60_000 } });
    await Item.count();
    expect(output()).toBe('');

    configureQueryLog({ queries: { slowMs: 0 } });
    await Item.count();
    expect(output()).toMatch(new RegExp(`WARN .*Slow query: QItem${s}\\.count .*slow=true`));
  });

  it('warns once per request about an N+1 pattern, naming the calling line', async () => {
    const output = captureStdout();
    configureLogger({ pretty: true });
    configureQueryLog({ queries: { slowMs: 60_000, nPlusOne: 3 } });
    await runWithContext({ requestId: 'r1' }, async () => {
      for (const sku of ['a', 'b', 'a', 'b', 'a']) await Item.findUnique({ where: { sku } });
    });
    const warnings = output().match(/Possible N\+1/g) ?? [];
    expect(warnings).toHaveLength(1);
    expect(output()).toMatch(
      new RegExp(
        `Possible N\\+1: QItem${s}\\.findUnique ran 3 times .*site=.*query-log\\.integration\\.test\\.ts:\\d+`,
      ),
    );

    // Separate requests never add up; outside a request there is nothing to count.
    for (let i = 0; i < 3; i++) {
      await runWithContext({ requestId: `r${i + 2}` }, () => Item.count());
    }
    for (let i = 0; i < 3; i++) await Item.count();
    expect(output().match(/Possible N\+1/g)).toHaveLength(1);
  });

  it('is off by default', async () => {
    const output = captureStdout();
    configureLogger({ pretty: true });
    configureQueryLog(undefined);
    await Item.count();
    expect(output()).toBe('');
  });
});
