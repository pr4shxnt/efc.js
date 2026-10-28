import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { defineCollection } from '../../db/collection-model.js';
import { setDbEngine } from '../../db/engine.js';
import { connectMongo } from '../../db/mongo.js';
import { loadMongoose } from '../../db/mongo-model.js';
import { pullMongo } from '../../db/pull-mongo.js';
import { modelFile, type ModelSource } from '../../db/codegen.js';

// `efc db pull` on MongoDB: documents written straight through the driver (no EFC model)
// are sampled into defineCollection models, which then read the same data and find
// nothing to change in sync.
const URL = process.env['EFC_TEST_MONGO_URL'] ?? 'mongodb://127.0.0.1:27017/efc_pull_mongo_test';

async function reachable(url: string): Promise<boolean> {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 1500 });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.close().catch(() => {});
  }
}

const available = await reachable(URL);

describe.skipIf(!available)('efc db pull (MongoDB)', () => {
  let models: ModelSource[];
  let byName: Record<string, ModelSource>;

  beforeAll(async () => {
    setDbEngine('mongodb');
    const conn = await connectMongo(URL);
    await conn.db!.dropDatabase();
    const mg = await loadMongoose();
    const { ObjectId, Decimal128, Long, Binary } = mg.mongo;
    const db = conn.db!;

    const ann = new ObjectId();
    await db.collection('owners').insertMany([{ _id: ann, name: 'Ann', email: 'ann@x.io' }]);
    await db.collection('owners').createIndex({ email: 1 }, { unique: true });

    const now = new Date();
    await db.collection('places').insertMany([
      {
        name: 'Cafe',
        owner: ann,
        price: Decimal128.fromString('4.50'),
        visits: Long.fromNumber(10),
        photo: new Binary(Buffer.from('hi')),
        location: { type: 'Point', coordinates: [85.3, 27.7] },
        tags: ['coffee', 'wifi'],
        address: { city: 'Kathmandu', zip: '44600' },
        reviews: [{ rating: 5, text: 'great' }],
        misc: 'a',
        createdAt: now,
        updatedAt: now,
      },
      {
        name: 'Bar',
        owner: ann,
        price: Decimal128.fromString('6.00'),
        visits: Long.fromNumber(2),
        location: { type: 'Point', coordinates: [85.31, 27.71] },
        tags: [],
        address: { city: 'Patan' },
        reviews: [],
        misc: 3,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.collection('places').createIndex({ location: '2dsphere' });
    await db.collection('places').createIndex({ name: 'text' });
    await db.collection('places').createIndex({ owner: 1, name: 1 }, { unique: true });
    await db
      .collection('places')
      .createIndex({ visits: -1 }, { partialFilterExpression: { visits: { $gt: 5 } } });

    // No timestamps, an unusual collection name.
    // `by` points at an owner (found by its ids, not its name); `ext` at nothing pulled.
    await db.collection('audit_log').insertOne({ action: 'login', at: now, by: ann, ext: new ObjectId() });
    await db.collection('audit_log').createIndex({ at: 1 }, { expireAfterSeconds: 3600 });

    ({ models } = await pullMongo(conn, mg.pluralize()!, { sample: 100 }));
    byName = Object.fromEntries(models.map((m) => [m.name, m]));
  });

  afterAll(async () => {
    const mg = await loadMongoose();
    await mg.connection.db?.dropDatabase();
    await mg.disconnect();
  });

  it('infers BSON types, embedded objects, arrays, required and refs', () => {
    expect(Object.keys(byName).sort()).toEqual(['AuditLog', 'Owner', 'Place']);
    const place = Object.fromEntries(byName['Place']!.fields);
    expect(place).toMatchObject({
      name: { type: 'string', required: true, index: 'text' },
      owner: { type: 'objectId', required: true, ref: 'Owner' },
      price: { type: 'decimal128', required: true },
      visits: { type: 'long', required: true },
      photo: { type: 'binary' }, // only one document has it
      location: { type: 'geoPoint', required: true, index: '2dsphere' },
      tags: { type: 'array', of: 'string' },
      address: {
        type: 'object',
        required: true,
        fields: { city: { type: 'string', required: true }, zip: { type: 'string' } },
      },
      reviews: [{ rating: { type: 'number', required: true }, text: { type: 'string', required: true } }],
      misc: { type: 'object', required: true }, // mixed string / number
    });
    expect(place['photo']).not.toHaveProperty('required');
    // timestamps (on by default) cover createdAt/updatedAt.
    expect(place).not.toHaveProperty('createdAt');
    expect(byName['Place']!.notes.join('\n')).toMatch(/misc: mixed types \(number, string\)/);
    expect(byName['Owner']!.fields).toContainEqual([
      'email',
      { type: 'string', required: true, unique: true },
    ]);
  });

  it('finds refs from the data when names do not give them away', () => {
    const log = Object.fromEntries(byName['AuditLog']!.fields);
    expect(log['by']).toEqual({ type: 'objectId', required: true, ref: 'Owner' });
    expect(log['ext']).toEqual({ type: 'objectId', required: true });
    expect(byName['AuditLog']!.notes.join('\n')).toMatch(/ext: holds ObjectIds — add ref/);
  });

  it('carries compound, partial and TTL indexes, collection names and timestamps', () => {
    expect(byName['Place']!.options).toEqual({
      indexes: [
        { fields: { owner: 1, name: 1 }, unique: true },
        { fields: { visits: -1 }, partialFilterExpression: { visits: { $gt: 5 } } },
      ],
    });
    expect(byName['AuditLog']!.options).toEqual({
      timestamps: false,
      indexes: [{ fields: { at: 1 }, expireAfterSeconds: 3600 }],
      collection: 'audit_log',
    });
    expect(modelFile(byName['AuditLog']!)).toMatch(
      /^import \{ defineCollection \} from 'express-file-cluster';[\s\S]*export const AuditLog = defineCollection\(\n {2}'AuditLog',/,
    );
  });

  it('the pulled models read the data and find nothing to sync', async () => {
    const built = Object.fromEntries(
      models.map((m) => [
        m.name,
        defineCollection(
          m.name,
          Object.fromEntries(m.fields) as never,
          m.options as never,
        ),
      ]),
    );
    for (const m of Object.values(built)) expect(await m.sync({ dryRun: true })).toEqual([]);

    const Place = built['Place']!;
    const cafe = (await Place.findOne({ name: 'Cafe' })) as Record<string, unknown>;
    expect(cafe).toMatchObject({
      price: '4.50',
      visits: 10n,
      address: { city: 'Kathmandu', zip: '44600' },
      reviews: [{ rating: 5, text: 'great' }],
    });
    const near = await Place.find({
      location: { $near: { $geometry: { type: 'Point', coordinates: [85.3, 27.7] }, $maxDistance: 50 } },
    } as never);
    expect(near.map((p) => (p as { name: string }).name)).toEqual(['Cafe']);
  });
});
