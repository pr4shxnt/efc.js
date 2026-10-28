import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { defineCollection } from '../../db/collection-model.js';
import { defineTable } from '../../db/table-model.js';
import { setDbEngine } from '../../db/engine.js';
import { connectMongo } from '../../db/mongo.js';
import { loadMongoose } from '../../db/mongo-model.js';
import { transaction } from '../../db/transaction.js';
import { ModelValidationError } from '../../db/schema.js';
import type { InferRecord } from '../../types.js';

// defineCollection (M5): the mongoose guide's queries, geo, text, aggregation, bulk
// writes, change streams and BSON types. Needs the MongoDB replica set (change streams,
// transactions); skips without it.
const RS_URL =
  process.env['EFC_TEST_MONGO_RS_URL'] ??
  'mongodb://127.0.0.1:27018/efc_collection_test?replicaSet=rs0&directConnection=true';

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

const available = await reachable(RS_URL);
const s = Math.random().toString(36).slice(2, 7);

const Owner = defineCollection(`COwner${s}`, {
  name: { type: 'string', required: true },
});

const Place = defineCollection(
  `CPlace${s}`,
  {
    name: { type: 'string', required: true },
    location: { type: 'geoPoint', index: '2dsphere' },
    price: { type: 'decimal128' },
    visits: { type: 'long', default: 0 },
    photo: { type: 'binary' },
    tags: { type: 'array', of: 'string', default: [] },
    owner: { type: 'objectId', ref: `COwner${s}` },
    reviews: [
      {
        rating: { type: 'number', required: true, min: 1, max: 5 },
        text: { type: 'string' },
      },
    ],
  },
  { indexes: [{ fields: { name: 'text' } }] },
);
type PlaceRecord = InferRecord<typeof Place>;

const Board = defineCollection(`CBoard${s}`, {
  title: { type: 'string', required: true },
  members: { type: 'array', of: 'objectId', ref: `COwner${s}`, default: [] },
});

const point = (lng: number, lat: number) => ({
  type: 'Point' as const,
  coordinates: [lng, lat] as [number, number],
});
const KTM = point(85.324, 27.7172);

describe.skipIf(!available)('defineCollection', () => {
  beforeAll(async () => {
    setDbEngine('mongodb');
    await connectMongo(RS_URL);
    await Owner.sync();
    await Place.sync();
    await Board.sync();
  });

  afterAll(async () => {
    await Place.drop();
    await Board.drop();
    await Owner.drop();
    await (await loadMongoose()).disconnect();
  });

  it('round-trips BSON types: decimal128 → string, long → bigint, binary → Buffer, geoPoint', async () => {
    const p = await Place.create({
      name: 'Durbar Square',
      location: KTM,
      price: '19.99',
      visits: 9007199254740993n,
      photo: Buffer.from('png!'),
    });
    expect(p.price).toBe('19.99');
    expect(p.visits).toBe(9007199254740993n);
    expect(Buffer.isBuffer(p.photo)).toBe(true);
    const read = (await Place.findById(p.id))!;
    expect(read.price).toBe('19.99');
    expect(read.visits).toBe(9007199254740993n);
    expect(read.photo?.toString()).toBe('png!');
    expect(read.location).toEqual(KTM);
    expect(typeof read.id).toBe('string');
    await Place.deleteMany();
  });

  it('validates on create and on updates', async () => {
    await expect(Place.create({ name: 'x', location: point(500, 0) })).rejects.toBeInstanceOf(
      ModelValidationError,
    );
    await expect(Place.create({} as never)).rejects.toBeInstanceOf(ModelValidationError);
    const p = await Place.create({ name: 'ok', reviews: [{ rating: 5 }] });
    await expect(
      Place.updateOne({ id: p.id }, { $push: { reviews: { rating: 9 } } }),
    ).rejects.toBeInstanceOf(ModelValidationError);
    await Place.deleteMany();
  });

  it('find with projection, sort, skip, limit; geo $near; $text', async () => {
    await Place.insertMany([
      { name: 'Boudha Stupa', location: point(85.362, 27.7215), tags: ['temple'] },
      { name: 'Swayambhu Temple', location: point(85.29, 27.7149), tags: ['temple', 'hill'] },
      { name: 'Pokhara Lake', location: point(83.9575, 28.2096), tags: ['lake'] },
    ]);
    const near = await Place.find(
      { location: { $near: { $geometry: KTM, $maxDistance: 5000 } } },
      { projection: { name: 1 } },
    );
    expect(near.map((p) => p.name)).toEqual(['Swayambhu Temple', 'Boudha Stupa']);
    expect(near[0]).not.toHaveProperty('tags');

    const page = await Place.find({ tags: 'temple' }, { sort: { name: 'asc' }, skip: 1, limit: 1 });
    expect(page.map((p) => p.name)).toEqual(['Swayambhu Temple']);

    const text = await Place.find({ $text: { $search: 'lake' } });
    expect(text.map((p) => p.name)).toEqual(['Pokhara Lake']);

    expect(await Place.countDocuments({ tags: 'temple' })).toBe(2);
    expect(await Place.exists({ name: 'Pokhara Lake' })).toBe(true);
    expect(await Place.distinct('tags')).toEqual(['hill', 'lake', 'temple']);
    await Place.deleteMany();
  });

  it('updates: results, findOneAndUpdate (before / after / upsert), replaceOne, deletes', async () => {
    const a = await Place.create({ name: 'A', visits: 1n });
    const r = await Place.updateMany({}, { $inc: { visits: 1 } });
    expect(r).toMatchObject({ matchedCount: 1, modifiedCount: 1, upsertedId: null });

    const before = await Place.findOneAndUpdate({ id: a.id }, { $set: { name: 'A2' } });
    expect(before?.name).toBe('A');
    const after = await Place.findOneAndUpdate(
      { id: a.id },
      { $inc: { visits: 1 } },
      { returnDocument: 'after' },
    );
    expect(after?.visits).toBe(3n);

    const up = await Place.findOneAndUpdate(
      { name: 'B' },
      { $setOnInsert: { tags: ['new'] } },
      { upsert: true, returnDocument: 'after' },
    );
    expect(up).toMatchObject({ name: 'B', tags: ['new'] });

    const rep = await Place.replaceOne({ name: 'B' }, { name: 'B2' });
    expect(rep.modifiedCount).toBe(1);
    expect((await Place.findOne({ name: 'B2' }))?.tags).toEqual([]);

    expect(await Place.findById('not-an-id')).toBeNull();
    expect((await Place.findByIdAndDelete(a.id))?.name).toBe('A2');
    expect(await Place.deleteMany()).toEqual({ deletedCount: 1 });
  });

  it('aggregate pipelines and populate', async () => {
    const ann = await Owner.create({ name: 'Ann' });
    await Place.insertMany([
      { name: 'X', owner: ann.id, reviews: [{ rating: 4 }, { rating: 2 }] },
      { name: 'Y', owner: ann.id, reviews: [{ rating: 5 }] },
    ]);
    const avg = await Place.aggregate<{ _id: string; avg: number }>([
      { $unwind: '$reviews' },
      { $group: { _id: '$name', avg: { $avg: '$reviews.rating' } } },
      { $sort: { _id: 1 } },
    ]);
    expect(avg.map((x) => [x._id, x.avg])).toEqual([
      ['X', 3],
      ['Y', 5],
    ]);
    const withOwner = await Place.findOne({ name: 'X' }, { populate: 'owner' });
    expect((withOwner?.owner as unknown as { name: string }).name).toBe('Ann');
    await Place.deleteMany();
    await Owner.deleteMany();
  });

  it('typed pipeline: match (ids cast), unwind, group, project, count, sort by id', async () => {
    const ann = await Owner.create({ name: 'Ann' });
    const bob = await Owner.create({ name: 'Bob' });
    await Place.insertMany([
      { name: 'X', owner: ann.id, price: '10.10', reviews: [{ rating: 4 }, { rating: 2 }] },
      { name: 'Y', owner: ann.id, price: '0.20', reviews: [{ rating: 5 }] },
      { name: 'Z', owner: bob.id, price: '1.00', reviews: [] },
    ]);

    // A string id in $match is cast to an ObjectId (raw aggregate() wouldn't match).
    const anns = await Place.pipeline().match({ owner: ann.id }).sort({ name: 1 });
    expect(anns.map((p) => p.name)).toEqual(['X', 'Y']);
    expect(await Place.aggregate([{ $match: { owner: ann.id } }])).toEqual([]);

    const ratings = await Place.pipeline()
      .unwind('$reviews')
      .group({ _id: '$name', avg: { $avg: '$reviews.rating' }, n: { $sum: 1 } })
      .stage({ $sort: { _id: 1 } });
    expect(ratings.map((r) => [r._id, r.avg, r.n])).toEqual([
      ['X', 3, 2],
      ['Y', 5, 1],
    ]);

    // $sum over decimal128 stays an exact decimal string.
    const [totals] = await Place.pipeline().group({ _id: null, revenue: { $sum: '$price' } });
    expect(totals!.revenue).toBe('11.30');

    const names = await Place.pipeline().project({ name: 1 }).stage({ $sort: { name: -1 } });
    expect(names).toEqual([
      expect.objectContaining({ name: 'Z', id: expect.any(String) }),
      expect.objectContaining({ name: 'Y' }),
      expect.objectContaining({ name: 'X' }),
    ]);
    expect(Object.keys(names[0]!).sort()).toEqual(['_id', 'id', 'name']);

    expect(await Place.pipeline().match({ name: { $in: ['X', 'Z'] } }).count('n')).toEqual([{ n: 2 }]);
    // `id` sorts by _id.
    const byId = await Place.pipeline().sort({ id: 1 });
    expect(byId.map((p) => p.name)).toEqual(['X', 'Y', 'Z']);

    await Place.deleteMany();
    await Owner.deleteMany();
  });

  it('lookup: a ref becomes its record (or null), an array of refs becomes records', async () => {
    const ann = await Owner.create({ name: 'Ann' });
    const bob = await Owner.create({ name: 'Bob' });
    await Place.insertMany([
      { name: 'Owned', owner: ann.id },
      { name: 'Orphan', owner: '64b000000000000000000000' }, // points at no one
      { name: 'Unowned' },
    ]);
    const places = await Place.lookup('owner', Owner, { name: { $ne: 'Nope' } });
    const byName = Object.fromEntries(places.map((p) => [p.name, p.owner]));
    expect(byName['Owned']).toMatchObject({ name: 'Ann', id: ann.id });
    expect(byName['Orphan']).toBeNull();
    expect(byName['Unowned']).toBeNull();

    await Board.create({ title: 'Team', members: [ann.id, bob.id] });
    await Board.create({ title: 'Empty' });
    const boards = await Board.pipeline().lookup('members', Owner).sort({ title: 1 });
    expect(boards.map((b) => [b.title, b.members.map((m) => m.name).sort()])).toEqual([
      ['Empty', []],
      ['Team', ['Ann', 'Bob']],
    ]);

    // The full form: owners with their places.
    const owners = await Owner.pipeline()
      .lookup({ from: Place, localField: 'id', foreignField: 'owner', as: 'places' })
      .sort({ name: 1 });
    expect(owners.map((o) => [o.name, o.places.map((p) => p.name)])).toEqual([
      ['Ann', ['Owned']],
      ['Bob', []],
    ]);

    await Place.deleteMany();
    await Board.deleteMany();
    await Owner.deleteMany();
  });

  it('bulkWrite', async () => {
    const a = await Place.create({ name: 'A' });
    const r = await Place.bulkWrite([
      { insertOne: { document: { name: 'B' } } },
      { updateOne: { filter: { id: a.id }, update: { $set: { tags: ['x'] } } } },
      { updateOne: { filter: { name: 'C' }, update: { $set: { tags: ['c'] } }, upsert: true } },
      { deleteOne: { filter: { name: 'B' } } },
    ]);
    expect(r).toEqual({
      insertedCount: 1,
      matchedCount: 1,
      modifiedCount: 1,
      deletedCount: 1,
      upsertedCount: 1,
    });
    expect((await Place.find({}, { sort: { name: 1 } })).map((p) => p.name)).toEqual(['A', 'C']);
    await Place.deleteMany();
  });

  it('watch streams changes', async () => {
    const stream = Place.watch([{ $match: { operationType: 'insert' } }]);
    const seen: string[] = [];
    const done = (async () => {
      for await (const change of stream) {
        seen.push(change.fullDocument!.name);
        if (seen.length === 2) break;
      }
    })();
    await new Promise((r) => setTimeout(r, 300)); // let the stream open
    await Place.create({ name: 'first' });
    await Place.updateMany({}, { $set: { tags: ['ignored'] } });
    await Place.create({ name: 'second' });
    await done;
    expect(seen).toEqual(['first', 'second']);
    await Place.deleteMany();
  });

  it('joins transactions', async () => {
    await expect(
      transaction(async () => {
        await Place.create({ name: 'rolled back' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await Place.countDocuments({ name: 'rolled back' })).toBe(0);
  });

  it('rejects SQL-only types and PostgreSQL connections', async () => {
    expect(() => defineCollection('Bad', { n: { type: 'integer' } } as never)).toThrow(
      'PostgreSQL-only',
    );
    expect(() => defineTable('Bad2', { n: { type: 'decimal128' } } as never)).toThrow(
      'MongoDB-only',
    );
    const Other = defineCollection(`COther${s}`, { n: { type: 'string' } });
    setDbEngine('postgresql');
    try {
      await expect(Other.find()).rejects.toThrow('is a MongoDB collection (defineCollection)');
    } finally {
      setDbEngine('mongodb');
    }
  });

  it('infers types', () => {
    // Compile-time only: the record type follows the schema.
    const check = (r: PlaceRecord): [string | undefined, bigint, string, Buffer | undefined] => [
      r.price,
      r.visits,
      r.id,
      r.photo,
    ];
    expect(check).toBeTypeOf('function');
  });
});
