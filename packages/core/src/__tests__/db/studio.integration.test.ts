import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type http from 'node:http';
import { startStudio } from '../../db/studio.js';
import { connectPostgres, closePostgres } from '../../db/postgres.js';
import { connectMongo } from '../../db/mongo.js';
import { loadMongoose } from '../../db/mongo-model.js';
import { setDbEngine, registeredModels } from '../../db/engine.js';
import { defineTable } from '../../db/table-model.js';
import { defineCollection } from '../../db/collection-model.js';

// `efc db studio`: read-only by default; `--write` edits through the models, and only for
// requests that carry the page's token from the studio's own origin. Self-skips per engine.
const PG_URL = process.env['EFC_TEST_PG_URL'] ?? 'postgres://postgres@127.0.0.1:5433/efc_test';
const MONGO_URL = process.env['EFC_TEST_MONGO_URL'] ?? 'mongodb://127.0.0.1:27017/efc_studio_test';
const s = Math.random().toString(36).slice(2, 7);

async function reachablePg(): Promise<boolean> {
  const { default: pg } = await import('pg');
  const c = new pg.Client({ connectionString: PG_URL, connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    return true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}
async function reachableMongo(): Promise<boolean> {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 1500 });
  try {
    await c.connect();
    return true;
  } catch {
    return false;
  } finally {
    await c.close().catch(() => {});
  }
}

/** Where a model stores, as the studio sees it. */
const storageOf = (modelName: string) =>
  registeredModels()
    .find((m) => m.name === modelName)!
    .studio!.storage();

/** The page's token, as the browser would read it. */
async function pageToken(url: string): Promise<string> {
  const html = await (await fetch(url)).text();
  return JSON.parse(/const TOKEN=("[^"]*");/.exec(html)![1]!) as string;
}

function writer(url: string, token: string) {
  return (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(url + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: url,
        'X-EFC-Studio-Token': token,
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
}

const Gadget = defineTable(
  `StudioGadget${s}`,
  {
    name: { type: 'string', required: true, minLength: 2 },
    qty: { type: 'integer', default: 0 },
  },
  { id: 'serial' },
);

const Widget = defineCollection(`StudioWidget${s}`, {
  name: { type: 'string', required: true },
  price: { type: 'decimal128' },
});

describe('efc db studio — table list', () => {
  it('leaves out a table dropped between listing and counting', async () => {
    // A pool where "gone" disappears after information_schema listed it.
    const pool = {
      query: async (sql: string) => {
        if (sql.includes('information_schema.tables')) {
          return { rows: [{ table_name: 'kept' }, { table_name: 'gone' }] };
        }
        if (sql.includes('"gone"')) throw new Error('relation "gone" does not exist');
        return { rows: [{ n: 3 }] };
      },
    };
    const { server, url } = await startStudio('postgresql', pool, 0);
    try {
      const res = await fetch(`${url}/api/collections`);
      expect(res.status).toBe(200);
      expect((await res.json()).collections).toEqual([{ name: 'kept', count: 3, writable: false }]);
    } finally {
      server.close();
    }
  });
});

describe.skipIf(!(await reachablePg()))('efc db studio (PostgreSQL)', () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    setDbEngine('postgresql');
    const pool = await connectPostgres(PG_URL);
    await Gadget.sync();
    ({ server, url } = await startStudio('postgresql', pool, 0, {
      write: true,
      models: registeredModels(),
    }));
  });
  afterAll(async () => {
    server?.close();
    await Gadget.drop();
    await closePostgres();
  });

  it('inserts, edits and deletes through the model (validation, defaults, serial ids)', async () => {
    const send = writer(url, await pageToken(url));
    const name = await storageOf(Gadget.name);
    const list = await (await fetch(`${url}/api/collections`)).json();
    expect(list.write).toBe(true);
    expect(list.collections.find((c: { name: string }) => c.name === name)).toMatchObject({
      writable: true,
    });

    const bad = await send('POST', `/api/collections/${name}`, { name: 'x' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).issues).toBeDefined();

    const created = await send('POST', `/api/collections/${name}`, { name: 'Lamp', id: 999 });
    expect(created.status).toBe(201);
    const { record } = await created.json();
    expect(record).toMatchObject({ name: 'Lamp', qty: 0 }); // default applied
    expect(record.id).not.toBe(999); // ids belong to the database

    const edited = await send('PATCH', `/api/collections/${name}/${record.id}`, { qty: 7 });
    expect(edited.status, await edited.clone().text()).toBe(200);
    expect((await edited.json()).record).toMatchObject({ id: record.id, qty: 7 });

    const del = await send('DELETE', `/api/collections/${name}/${record.id}`);
    expect(del.status).toBe(200);
    expect((await send('DELETE', `/api/collections/${name}/${record.id}`)).status).toBe(404);
  });

  it('refuses writes without the token, from another origin, or to unmodelled tables', async () => {
    const token = await pageToken(url);
    const name = await storageOf(Gadget.name);
    const send = writer(url, token);
    expect(
      (await writer(url, '')('POST', `/api/collections/${name}`, { name: 'Nope' })).status,
    ).toBe(403);
    expect(
      (await writer(url, 'f'.repeat(64))('POST', `/api/collections/${name}`, { name: 'Nope' }))
        .status,
    ).toBe(403);
    expect(
      (
        await send(
          'POST',
          `/api/collections/${name}`,
          { name: 'Nope' },
          { Origin: 'http://evil.example' },
        )
      ).status,
    ).toBe(403);
    // A form post (no JSON content type) can't be a write either.
    expect(
      (await send('POST', `/api/collections/${name}`, undefined, { 'Content-Type': 'text/plain' }))
        .status,
    ).toBe(403);
    // DNS rebinding: a request addressed to another host name. (fetch won't set Host.)
    const rebound = await new Promise<number>((resolve, reject) => {
      const { port } = new URL(url);
      import('node:http').then(({ request }) =>
        request(
          { host: '127.0.0.1', port, path: '/api/collections', headers: { Host: 'evil.example' } },
          (r) => resolve(r.statusCode!),
        )
          .on('error', reject)
          .end(),
      );
    });
    expect(rebound).toBe(403);
    // A table no model stores in is read-only.
    const pool = (await import('../../db/postgres.js')).getPool();
    await pool.query(`CREATE TABLE IF NOT EXISTS studio_raw_${s} (id int primary key)`);
    try {
      const r = await send('POST', `/api/collections/studio_raw_${s}`, { id: 1 });
      expect(r.status).toBe(409);
    } finally {
      await pool.query(`DROP TABLE studio_raw_${s}`);
    }
  });

  it('stays read-only without --write', async () => {
    const pool = (await import('../../db/postgres.js')).getPool();
    const ro = await startStudio('postgresql', pool, 0);
    try {
      const page = await (await fetch(ro.url)).text();
      expect(page).toContain('const TOKEN="";');
      // The page's script must parse (escapes in the template literal have bitten before).
      const script = /<script>([\s\S]*)<\/script>/.exec(page)![1]!;
      expect(() => new Function(script)).not.toThrow();
      const list = await (await fetch(`${ro.url}/api/collections`)).json();
      expect(list.write).toBe(false);
      const r = await fetch(`${ro.url}/api/collections/anything`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ro.url },
        body: '{}',
      });
      expect(r.status).toBe(405);
    } finally {
      ro.server.close();
    }
  });
});

describe.skipIf(!(await reachableMongo()))('efc db studio (MongoDB)', () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    setDbEngine('mongodb');
    const conn = await connectMongo(MONGO_URL);
    await Widget.sync();
    ({ server, url } = await startStudio('mongodb', conn, 0, {
      write: true,
      models: registeredModels(),
    }));
  });
  afterAll(async () => {
    server?.close();
    const mg = await loadMongoose();
    await mg.connection.db?.dropDatabase();
    await mg.disconnect();
  });

  it('writes through defineCollection; models for the other engine are not writable', async () => {
    const send = writer(url, await pageToken(url));
    const name = await storageOf(Widget.name);
    const list = await (await fetch(`${url}/api/collections`)).json();
    expect(list.collections.find((c: { name: string }) => c.name === name)).toMatchObject({
      writable: true,
    });
    // Gadget (defineTable) is registered too, but has no collection here.
    expect(list.collections.some((c: { name: string }) => c.name.includes('gadget'))).toBe(false);

    const created = await send('POST', `/api/collections/${name}`, {
      name: 'Gear',
      price: '9.99',
      _id: 'x',
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const { record } = await created.json();
    expect(record).toMatchObject({ name: 'Gear', price: '9.99' });

    const edited = await send('PATCH', `/api/collections/${name}/${record.id}`, { name: 'Cog' });
    expect((await edited.json()).record).toMatchObject({ name: 'Cog' });
    const rows = await (await fetch(`${url}/api/collections/${name}`)).json();
    expect(rows.rows.map((r: { name: string }) => r.name)).toEqual(['Cog']);

    const bad = await send('PATCH', `/api/collections/${name}/${record.id}`, {
      price: 'not a number',
    });
    expect(bad.status, await bad.clone().text()).toBe(400);
    expect((await send('DELETE', `/api/collections/${name}/${record.id}`)).status).toBe(200);
  });
});
