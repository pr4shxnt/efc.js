import type * as MongooseNS from 'mongoose';
import type {
  CollectionSchema,
  InferCreateInput,
  InferSchema,
  ModelOptions,
  Simplify,
  SortDirection,
} from '../types.js';
import { normalizeSchema, type FieldNode, type SchemaTree } from './schema.js';
import { currentTx, getDbEngine, registerModel } from './engine.js';
import { mongoModel, normalise, translateError, mapFilter, mapSort } from './mongo-model.js';
import { traceOps } from './query-log.js';
import { Pipeline, type LookedUp, type LookupTarget } from './pipeline.js';

// defineCollection: a MongoDB-native model with mongoose's vocabulary — find with
// projections, findOneAndUpdate, bulkWrite, aggregation, change streams — and BSON types
// (decimal128, long, geoPoint, binary). It shares defineModel's MongoDB adapter for schema
// compilation, validation, sync and migration planning; only the query layer is native.

type AnyRecord = Record<string, unknown>;

export interface CollectionOptions extends ModelOptions {
  /** Default collation for this collection's queries, e.g. `{ locale: 'en', strength: 2 }`. */
  collation?: AnyRecord;
}

export interface CollectionFindOptions {
  /** Inclusion (`{ name: 1 }`) or exclusion (`{ secret: 0 }`) projection. */
  projection?: Record<string, 0 | 1 | boolean | AnyRecord>;
  sort?: Record<string, SortDirection | { $meta: 'textScore' }>;
  skip?: number;
  limit?: number;
  /** Resolve `objectId` fields that have a `ref` into the referenced documents. */
  populate?: string | string[];
  collation?: AnyRecord;
}

export interface CollectionWriteResult {
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  upsertedId: string | null;
}

export interface CollectionBulkResult {
  insertedCount: number;
  matchedCount: number;
  modifiedCount: number;
  deletedCount: number;
  upsertedCount: number;
}

/** A change stream: iterate with `for await`, stop with `close()` (or `break`). */
export interface CollectionChangeStream<R> extends AsyncIterable<CollectionChange<R>> {
  close(): Promise<void>;
}

export interface CollectionChange<R> {
  operationType: string;
  /** The document id. */
  id: string | undefined;
  /** The new document (inserts, replaces; updates with `fullDocument: 'updateLookup'`). */
  fullDocument?: R;
  updateDescription?: { updatedFields: AnyRecord; removedFields: string[] };
  raw: AnyRecord;
}

/** BSON values from `lean()` reads, as records hold them: decimals → strings, longs → bigints. */
function fromBson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromBson);
  if (value == null || typeof value !== 'object') return value;
  switch ((value as { _bsontype?: string })._bsontype) {
    case 'Decimal128':
      return String(value);
    case 'Long':
      return BigInt(String(value));
    case 'Binary':
      return Buffer.from((value as { buffer: Uint8Array }).buffer);
    case undefined:
      break;
    default:
      return value; // ObjectId and friends pass through, as on defineModel
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;
  const out: AnyRecord = {};
  for (const [k, v] of Object.entries(value as AnyRecord)) out[k] = fromBson(v);
  return out;
}

/**
 * The driver hands back int64 values that fit in 53 bits as numbers: `long` fields are
 * bigints whatever their size, so cast them by the schema.
 */
function castLongs(value: unknown, node: FieldNode): unknown {
  if (value == null) return value;
  if (node.kind === 'scalar') {
    return node.type === 'long' && typeof value === 'number' ? BigInt(value) : value;
  }
  if (node.kind === 'array' && Array.isArray(value))
    return value.map((v) => castLongs(v, node.item));
  if (node.kind === 'object' && typeof value === 'object') {
    castTree(value as AnyRecord, node.fields);
  }
  return value;
}

function castTree(doc: AnyRecord, tree: SchemaTree): AnyRecord {
  for (const [key, node] of Object.entries(tree)) {
    if (key in doc) doc[key] = castLongs(doc[key], node);
  }
  return doc;
}

/** Whether the schema has a `long` anywhere (most don't: skip the walk). */
function hasLong(tree: SchemaTree): boolean {
  const walk = (n: FieldNode): boolean =>
    n.kind === 'scalar'
      ? n.type === 'long'
      : n.kind === 'array'
        ? walk(n.item)
        : n.kind === 'object'
          ? hasLong(n.fields)
          : false;
  return Object.values(tree).some(walk);
}

function writeResult(r: {
  matchedCount?: number;
  modifiedCount?: number;
  upsertedCount?: number;
  upsertedId?: unknown;
}): CollectionWriteResult {
  return {
    matchedCount: r.matchedCount ?? 0,
    modifiedCount: r.modifiedCount ?? 0,
    upsertedCount: r.upsertedCount ?? 0,
    upsertedId: r.upsertedId == null ? null : String(r.upsertedId),
  };
}

/** `id` → `_id` in bulkWrite operations' filters. */
function mapBulkOp(op: AnyRecord): AnyRecord {
  const [kind, body] = Object.entries(op)[0] ?? [];
  if (!kind || body == null || typeof body !== 'object') return op;
  const b = { ...(body as AnyRecord) };
  if (b['filter']) b['filter'] = mapFilter(b['filter'] as AnyRecord);
  return { [kind]: b };
}

function createCollection(name: string, schema: CollectionSchema, options: CollectionOptions) {
  const tree = normalizeSchema(schema, 'collection', name);
  const base = mongoModel<AnyRecord>(name, tree, options);
  const longs = hasLong(tree);
  const toRecord = (doc: unknown): AnyRecord | null => {
    if (doc == null) return null;
    const rec = normalise(fromBson(doc)) as AnyRecord;
    return longs ? castTree(rec, tree) : rec;
  };

  const model = async (): Promise<MongooseNS.Model<AnyRecord>> => {
    const engine = getDbEngine();
    if (engine !== 'mongodb') {
      throw new Error(
        `[EFC] ${name} is a MongoDB collection (defineCollection) but the app is connected to PostgreSQL — check DATABASE_URL / config.database, or use defineModel for a model that runs on both`,
      );
    }
    return (await base.raw()) as MongooseNS.Model<AnyRecord>;
  };

  const session = (): MongooseNS.ClientSession | null => {
    const tx = currentTx();
    return tx?.engine === 'mongodb' ? (tx.session as MongooseNS.ClientSession) : null;
  };

  const sess = (): { session?: MongooseNS.ClientSession } => {
    const s = session();
    return s ? { session: s } : {};
  };

  // The typed builder's stages. mongoose doesn't cast aggregation pipelines, so while the
  // records still have this collection's shape, $match and $sort get the same treatment as
  // find(): `id` → `_id`, string ids → ObjectIds, schema casting. Later stages (after a
  // group, lookup, project…) describe a different shape and pass through as written.
  const runPipeline = (stages: AnyRecord[]): Promise<unknown[]> =>
    guard(async (M) => {
      let sourceShape = true;
      const prepared = stages.map((stage) => {
        const [op] = Object.keys(stage);
        if (!sourceShape) return stage;
        if (op === '$match') {
          const filter = mapFilter(stage['$match'] as AnyRecord);
          return { $match: M.find().cast(M, filter) as AnyRecord };
        }
        if (op === '$sort') return { $sort: mapSort(stage['$sort'] as Record<string, SortDirection>) };
        if (op !== '$skip' && op !== '$limit' && op !== '$sample') sourceShape = false;
        return stage;
      });
      const agg = M.aggregate(prepared as unknown as MongooseNS.PipelineStage[]);
      const s = session();
      if (s) agg.session(s);
      if (options.collation)
        agg.collation(options.collation as unknown as MongooseNS.mongo.CollationOptions);
      return ((await agg) as unknown[]).map(toRecord);
    });

  const guard = async <R>(fn: (M: MongooseNS.Model<AnyRecord>) => Promise<R>): Promise<R> => {
    const M = await model();
    try {
      return await fn(M);
    } catch (err) {
      return translateError(name, err);
    }
  };

  const findOpts = <Q extends MongooseNS.Query<unknown, unknown>>(
    q: Q,
    opts?: CollectionFindOptions,
  ): Q => {
    if (opts?.projection) q.select(opts.projection);
    if (opts?.sort) {
      const meta = Object.values(opts.sort).some((v) => typeof v === 'object');
      q.sort(meta ? opts.sort : mapSort(opts.sort as Record<string, SortDirection>));
    }
    if (opts?.skip !== undefined) q.skip(opts.skip);
    if (opts?.limit !== undefined) q.limit(opts.limit);
    if (opts?.populate) q.populate(opts.populate);
    const collation = opts?.collation ?? options.collation;
    if (collation) q.collation(collation as unknown as MongooseNS.mongo.CollationOptions);
    q.session(session());
    return q;
  };

  const isBadId = (err: unknown) => {
    const e = err as { name?: string; path?: string };
    return e?.name === 'CastError' && e.path === '_id';
  };

  const model$ = {
    name,

    find: (filter?: AnyRecord, opts?: CollectionFindOptions) =>
      guard(async (M) => {
        const docs = await findOpts(M.find(mapFilter(filter)), opts).lean();
        return (docs as unknown[]).map(toRecord);
      }),

    findOne: (filter?: AnyRecord, opts?: CollectionFindOptions) =>
      guard(async (M) => toRecord(await findOpts(M.findOne(mapFilter(filter)), opts).lean())),

    findById: (id: string, opts?: CollectionFindOptions) =>
      guard(async (M) => {
        try {
          return toRecord(await findOpts(M.findById(id), opts).lean());
        } catch (err) {
          if (isBadId(err)) return null;
          throw err;
        }
      }),

    exists: (filter: AnyRecord) =>
      guard(async (M) => (await M.exists(mapFilter(filter)).session(session())) !== null),

    countDocuments: (filter?: AnyRecord) =>
      guard((M) => M.countDocuments(mapFilter(filter)).session(session()).exec()),

    estimatedDocumentCount: () => guard((M) => M.estimatedDocumentCount().exec()),

    distinct: (field: string, filter?: AnyRecord) =>
      guard(async (M) => {
        const values = await M.distinct(field === 'id' ? '_id' : field, mapFilter(filter)).session(
          session(),
        );
        return (values as unknown[]).map((v) =>
          v != null && (v as { _bsontype?: string })._bsontype === 'ObjectId'
            ? String(v)
            : fromBson(v),
        );
      }),

    create: (data: AnyRecord) =>
      guard(async (M) => {
        const [doc] = await M.create([data], sess());
        return toRecord(doc!.toObject({ flattenMaps: true }));
      }),

    insertMany: (data: AnyRecord[]) =>
      guard(async (M) => {
        if (data.length === 0) return [];
        const docs = await M.create(data, { ...sess(), ordered: true });
        return docs.map((d) => toRecord(d.toObject({ flattenMaps: true })));
      }),

    updateOne: (filter: AnyRecord, update: AnyRecord, opts?: { upsert?: boolean }) =>
      guard(async (M) =>
        writeResult(
          await M.updateOne(mapFilter(filter), update, {
            runValidators: true,
            upsert: opts?.upsert ?? false,
            ...sess(),
          }),
        ),
      ),

    updateMany: (filter: AnyRecord, update: AnyRecord, opts?: { upsert?: boolean }) =>
      guard(async (M) =>
        writeResult(
          await M.updateMany(mapFilter(filter), update, {
            runValidators: true,
            upsert: opts?.upsert ?? false,
            ...sess(),
          }),
        ),
      ),

    replaceOne: (filter: AnyRecord, replacement: AnyRecord, opts?: { upsert?: boolean }) =>
      guard(async (M) =>
        writeResult(
          await M.replaceOne(mapFilter(filter), replacement, {
            runValidators: true,
            upsert: opts?.upsert ?? false,
            ...sess(),
          }),
        ),
      ),

    findOneAndUpdate: (
      filter: AnyRecord,
      update: AnyRecord,
      opts?: {
        upsert?: boolean;
        returnDocument?: 'before' | 'after';
        projection?: CollectionFindOptions['projection'];
        sort?: CollectionFindOptions['sort'];
      },
    ) =>
      guard(async (M) =>
        toRecord(
          await M.findOneAndUpdate(mapFilter(filter), update, {
            runValidators: true,
            upsert: opts?.upsert ?? false,
            returnDocument: opts?.returnDocument ?? 'before',
            ...(opts?.projection && { projection: opts.projection }),
            ...(opts?.sort && { sort: opts.sort }),
            ...sess(),
          }).lean(),
        ),
      ),

    findByIdAndUpdate: (
      id: string,
      update: AnyRecord,
      opts?: { returnDocument?: 'before' | 'after' },
    ) =>
      guard(async (M) => {
        try {
          return toRecord(
            await M.findByIdAndUpdate(id, update, {
              runValidators: true,
              returnDocument: opts?.returnDocument ?? 'before',
              ...sess(),
            }).lean(),
          );
        } catch (err) {
          if (isBadId(err)) return null;
          throw err;
        }
      }),

    findOneAndDelete: (filter: AnyRecord, opts?: { sort?: CollectionFindOptions['sort'] }) =>
      guard(async (M) =>
        toRecord(
          await M.findOneAndDelete(mapFilter(filter), {
            ...(opts?.sort && { sort: opts.sort }),
            ...sess(),
          }).lean(),
        ),
      ),

    findByIdAndDelete: (id: string) =>
      guard(async (M) => {
        try {
          return toRecord(await M.findByIdAndDelete(id, sess()).lean());
        } catch (err) {
          if (isBadId(err)) return null;
          throw err;
        }
      }),

    deleteOne: (filter: AnyRecord) =>
      guard(async (M) => ({
        deletedCount: (await M.deleteOne(mapFilter(filter), sess())).deletedCount,
      })),

    deleteMany: (filter?: AnyRecord) =>
      guard(async (M) => ({
        deletedCount: (await M.deleteMany(mapFilter(filter), sess())).deletedCount,
      })),

    aggregate: (pipeline: AnyRecord[]) =>
      guard(async (M) => {
        const agg = M.aggregate(pipeline as unknown as MongooseNS.PipelineStage[]);
        const s = session();
        if (s) agg.session(s);
        if (options.collation)
          agg.collation(options.collation as unknown as MongooseNS.mongo.CollationOptions);
        return ((await agg) as unknown[]).map(toRecord);
      }),

    pipeline: () => new Pipeline(runPipeline),

    lookup: (field: string, target: LookupTarget, filter?: AnyRecord) =>
      new Pipeline(runPipeline).match(filter ?? {}).lookup(field as never, target).exec(),

    bulkWrite: (ops: AnyRecord[], opts?: { ordered?: boolean }) =>
      guard(async (M): Promise<CollectionBulkResult> => {
        if (ops.length === 0) {
          return {
            insertedCount: 0,
            matchedCount: 0,
            modifiedCount: 0,
            deletedCount: 0,
            upsertedCount: 0,
          };
        }
        const r = await M.bulkWrite(
          ops.map(mapBulkOp) as never,
          {
            ordered: opts?.ordered ?? true,
            runValidators: true,
            ...sess(),
          } as never,
        );
        return {
          insertedCount: r.insertedCount,
          matchedCount: r.matchedCount,
          modifiedCount: r.modifiedCount,
          deletedCount: r.deletedCount,
          upsertedCount: r.upsertedCount,
        };
      }),

    watch: (
      pipeline: AnyRecord[] = [],
      opts?: { fullDocument?: 'default' | 'updateLookup' | 'whenAvailable' | 'required' },
    ): CollectionChangeStream<AnyRecord> => {
      let stream: MongooseNS.mongo.ChangeStream | undefined;
      let closed = false;
      const open = async () => {
        const M = await model();
        stream ??= M.watch(pipeline, {
          ...(opts?.fullDocument && { fullDocument: opts.fullDocument }),
        }) as unknown as MongooseNS.mongo.ChangeStream;
        return stream;
      };
      const close = async () => {
        closed = true;
        await stream?.close();
      };
      return {
        close,
        async *[Symbol.asyncIterator]() {
          const s = await open();
          try {
            while (!closed) {
              const change = (await s.next().catch((err: unknown) => {
                if (closed) return null; // closed while waiting
                throw err;
              })) as AnyRecord | null;
              if (!change) return;
              const key = change['documentKey'] as { _id?: unknown } | undefined;
              yield {
                operationType: String(change['operationType']),
                id: key?._id == null ? undefined : String(key._id),
                ...(change['fullDocument'] != null && {
                  fullDocument: toRecord(change['fullDocument']) as AnyRecord,
                }),
                ...(change['updateDescription'] != null && {
                  updateDescription: fromBson(change['updateDescription']) as never,
                }),
                raw: change,
              };
            }
          } finally {
            await close();
          }
        },
      };
    },

    raw: () => model(),
    sync: (opts?: { dryRun?: boolean }) => model().then(() => base.sync(opts)),
    drop: () => model().then(() => base.drop()),
  };

  traceOps(
    name,
    model$,
    Object.keys(model$).filter((op) => !['name', 'raw', 'sync', 'drop', 'watch'].includes(op)),
  );
  registerModel({
    name,
    sync: model$.sync,
    plan: (opts) => model().then(() => base.plan(opts)),
    drop: model$.drop,
    findByIds: (ids) => model$.find({ _id: { $in: ids } }) as Promise<AnyRecord[]>,
    pgTarget: () => {
      throw new Error(`[EFC] ${name} is a MongoDB collection (defineCollection)`);
    },
  });
  return model$;
}

/**
 * Defines a MongoDB-native model with mongoose's vocabulary — `find` with projections,
 * `findOneAndUpdate` with upsert, `bulkWrite`, aggregation pipelines, change streams —
 * and BSON types (`decimal128`, `long`, `geoPoint`, `binary`). Record and input types are
 * inferred from the schema. Throws at first use on a PostgreSQL connection.
 */
export function defineCollection<
  const S extends CollectionSchema,
  const O extends CollectionOptions = object,
>(name: string, schema: S, options?: O): CollectionModel<S, O> {
  return createCollection(name, schema, options ?? {}) as unknown as CollectionModel<S, O>;
}

// ── Types ────────────────────────────────────────────────────────────────────

type Rec<S, O> = Simplify<InferSchema<S, O> & { id: string }>;
type Elem<V> = V extends readonly (infer E)[] ? E : never;

/** A query filter: fields (with an array's element for "contains"), operators, dotted paths. */
export type CollectionFilter<R> = {
  [K in keyof R]?: R[K] | Elem<R[K]> | null | { [op: `$${string}`]: unknown };
} & {
  [path: `${string}.${string}`]: unknown;
  _id?: unknown;
  $and?: CollectionFilter<R>[];
  $or?: CollectionFilter<R>[];
  $nor?: CollectionFilter<R>[];
  $text?: { $search: string; $language?: string; $caseSensitive?: boolean };
  $expr?: unknown;
};

type Fields<R> = { [K in keyof R]?: unknown } & { [path: `${string}.${string}`]: unknown };

/** Plain fields (shorthand for `$set`) and/or update operators. */
export type CollectionUpdate<R> =
  | Partial<R>
  | {
      $set?: Fields<R>;
      $unset?: Fields<R>;
      $inc?: Fields<R>;
      $mul?: Fields<R>;
      $min?: Fields<R>;
      $max?: Fields<R>;
      $push?: Fields<R>;
      $pull?: Fields<R>;
      $addToSet?: Fields<R>;
      $pop?: Fields<R>;
      $rename?: Record<string, string>;
      $setOnInsert?: Fields<R>;
      $currentDate?: Fields<R>;
    };

export type CollectionBulkOp<R, C> =
  | { insertOne: { document: C } }
  | { updateOne: { filter: CollectionFilter<R>; update: CollectionUpdate<R>; upsert?: boolean } }
  | { updateMany: { filter: CollectionFilter<R>; update: CollectionUpdate<R>; upsert?: boolean } }
  | { replaceOne: { filter: CollectionFilter<R>; replacement: C; upsert?: boolean } }
  | { deleteOne: { filter: CollectionFilter<R> } }
  | { deleteMany: { filter: CollectionFilter<R> } };

export interface CollectionModel<S, O = object, R = Rec<S, O>, C = InferCreateInput<S>> {
  readonly name: string;
  /** Inferred types: `InferRecord<typeof Place>`, `InferCreate<typeof Place>`. */
  readonly $types?: { record: R; create: C };
  find(filter?: CollectionFilter<R>, options?: CollectionFindOptions): Promise<R[]>;
  findOne(filter?: CollectionFilter<R>, options?: CollectionFindOptions): Promise<R | null>;
  findById(id: string, options?: CollectionFindOptions): Promise<R | null>;
  exists(filter: CollectionFilter<R>): Promise<boolean>;
  countDocuments(filter?: CollectionFilter<R>): Promise<number>;
  /** Fast count from collection metadata (ignores filters and transactions). */
  estimatedDocumentCount(): Promise<number>;
  distinct<K extends keyof R & string>(
    field: K | `${string}.${string}`,
    filter?: CollectionFilter<R>,
  ): Promise<(K extends keyof R ? Elem<R[K]> | Exclude<R[K], readonly unknown[]> : unknown)[]>;
  create(data: C): Promise<R>;
  insertMany(data: C[]): Promise<R[]>;
  updateOne(
    filter: CollectionFilter<R>,
    update: CollectionUpdate<R>,
    options?: { upsert?: boolean },
  ): Promise<CollectionWriteResult>;
  updateMany(
    filter: CollectionFilter<R>,
    update: CollectionUpdate<R>,
    options?: { upsert?: boolean },
  ): Promise<CollectionWriteResult>;
  replaceOne(
    filter: CollectionFilter<R>,
    replacement: C,
    options?: { upsert?: boolean },
  ): Promise<CollectionWriteResult>;
  /** Returns the document before the update unless `returnDocument: 'after'` (as mongoose). */
  findOneAndUpdate(
    filter: CollectionFilter<R>,
    update: CollectionUpdate<R>,
    options?: {
      upsert?: boolean;
      returnDocument?: 'before' | 'after';
      projection?: CollectionFindOptions['projection'];
      sort?: CollectionFindOptions['sort'];
    },
  ): Promise<R | null>;
  findByIdAndUpdate(
    id: string,
    update: CollectionUpdate<R>,
    options?: { returnDocument?: 'before' | 'after' },
  ): Promise<R | null>;
  findOneAndDelete(
    filter: CollectionFilter<R>,
    options?: { sort?: CollectionFindOptions['sort'] },
  ): Promise<R | null>;
  findByIdAndDelete(id: string): Promise<R | null>;
  deleteOne(filter: CollectionFilter<R>): Promise<{ deletedCount: number }>;
  deleteMany(filter?: CollectionFilter<R>): Promise<{ deletedCount: number }>;
  /**
   * A typed aggregation pipeline: `Order.pipeline().match({ … }).group({ _id: '$customer',
   * total: { $sum: '$amount' } })` — each stage's output type is inferred. Await it (or `.exec()`).
   */
  pipeline(): Pipeline<R>;
  /**
   * `$lookup` for a ref field: `Post.lookup('author', User)` → posts whose `author` is the User
   * record (or null); an array of refs becomes an array of records. Optional filter first.
   */
  lookup<K extends keyof R & string, M extends LookupTarget>(
    field: K,
    from: M,
    filter?: CollectionFilter<R>,
  ): Promise<LookedUp<R, K, M>[]>;
  /** An aggregation pipeline; type the output with the generic: `aggregate<{ _id: string; n: number }>(…)`. */
  aggregate<T = Record<string, unknown>>(pipeline: Record<string, unknown>[]): Promise<T[]>;
  bulkWrite(
    ops: CollectionBulkOp<R, C>[],
    options?: { ordered?: boolean },
  ): Promise<CollectionBulkResult>;
  /** A change stream (needs a replica set). */
  watch(
    pipeline?: Record<string, unknown>[],
    options?: { fullDocument?: 'default' | 'updateLookup' | 'whenAvailable' | 'required' },
  ): CollectionChangeStream<R>;
  /** The mongoose `Model`. */
  raw(): Promise<unknown>;
  sync(options?: { dryRun?: boolean }): Promise<string[]>;
  drop(): Promise<void>;
}
