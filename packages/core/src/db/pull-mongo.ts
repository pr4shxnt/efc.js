// `efc db pull` on MongoDB: samples each collection's documents and indexes and describes
// them as `defineCollection` models. MongoDB has no schema to read, so field types come
// from the data: a field is `required` only when every sampled document has a value.
import type * as MongooseNS from 'mongoose';
import { pascal, singular, type ModelSource } from './codegen.js';

type AnyRecord = Record<string, unknown>;

/** Collections EFC keeps for itself. */
const INTERNAL = new Set(['efc_migrations', 'efc_counters']);

/** What one field held across the sampled documents. */
interface Shape {
  /** Documents (or array elements / parent objects) where the field had a non-null value. */
  present: number;
  kinds: Map<string, number>;
  /** Sub-fields, when the field held plain objects. */
  fields?: Map<string, Shape>;
  /** Element shape, when the field held arrays. */
  elements?: Shape;
  sawEmptyArray?: boolean;
}

const newShape = (): Shape => ({ present: 0, kinds: new Map() });

function bsonKind(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (v instanceof Date) return 'date';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') {
    switch ((v as { _bsontype?: string })._bsontype) {
      case 'ObjectId':
      case 'ObjectID':
        return 'objectId';
      case 'Decimal128':
        return 'decimal128';
      case 'Long':
        return 'long';
      case 'Int32':
      case 'Double':
        return 'number';
      case 'Binary':
        return 'binary';
      case undefined:
        break;
      default:
        return 'other';
    }
    if (Buffer.isBuffer(v)) return 'binary';
    const o = v as AnyRecord;
    if (
      o['type'] === 'Point' &&
      Array.isArray(o['coordinates']) &&
      o['coordinates'].length === 2 &&
      o['coordinates'].every((c) => bsonKind(c) === 'number')
    ) {
      return 'geoPoint';
    }
    return 'object';
  }
  return 'other';
}

function observe(shape: Shape, value: unknown): void {
  const kind = bsonKind(value);
  if (kind === 'null') return;
  shape.present++;
  shape.kinds.set(kind, (shape.kinds.get(kind) ?? 0) + 1);
  if (kind === 'object') {
    shape.fields ??= new Map();
    observeObject(shape.fields, value as AnyRecord);
  } else if (kind === 'array') {
    const arr = value as unknown[];
    if (arr.length === 0) shape.sawEmptyArray = true;
    shape.elements ??= newShape();
    for (const el of arr) observe(shape.elements, el);
  }
}

function observeObject(fields: Map<string, Shape>, doc: AnyRecord): void {
  for (const [k, v] of Object.entries(doc)) {
    if (k.startsWith('$') || k.includes('.')) continue;
    let s = fields.get(k);
    if (!s) fields.set(k, (s = newShape()));
    observe(s, v);
  }
}

interface Ctx {
  notes: string[];
  /** Model names of the other pulled collections, for `ref` guesses. */
  models: Map<string, string>;
}

/** The schema entry for a field (or `undefined` to leave it out). */
function fieldDef(
  name: string,
  shape: Shape,
  total: number,
  path: string,
  ctx: Ctx,
): AnyRecord | [AnyRecord] | undefined {
  const kinds = [...shape.kinds.keys()];
  const required = total > 0 && shape.present === total;
  if (kinds.length === 0) {
    ctx.notes.push(`${path}: always null in the sample — typed as any (object)`);
    return { type: 'object' };
  }
  if (kinds.length > 1) {
    ctx.notes.push(`${path}: mixed types (${kinds.sort().join(', ')}) — typed as any (object)`);
    return { type: 'object', ...(required && { required: true }) };
  }
  const kind = kinds[0]!;
  if (kind === 'other') {
    ctx.notes.push(`${path}: a BSON type EFC doesn't model — typed as any (object)`);
    return { type: 'object' };
  }
  if (kind === 'object') {
    const sub = schemaOf(shape.fields!, shape.present, path, ctx);
    return required ? { type: 'object', required: true, fields: sub } : sub;
  }
  if (kind === 'array') {
    const el = shape.elements!;
    const elKinds = [...el.kinds.keys()];
    if (elKinds.length === 1 && elKinds[0] === 'object') {
      return [schemaOf(el.fields!, el.present, `${path}[]`, ctx)];
    }
    if (elKinds.length === 1 && elKinds[0] !== 'array' && elKinds[0] !== 'other') {
      const of = elKinds[0]!;
      return { type: 'array', of, ...(of === 'objectId' && refFor(name, ctx)) };
    }
    if (elKinds.length === 0) {
      ctx.notes.push(`${path}: only empty arrays in the sample — element type unknown (object)`);
    } else {
      ctx.notes.push(`${path}: array elements of mixed types — typed as any (object)`);
    }
    return { type: 'array', of: 'object' };
  }
  return {
    type: kind,
    ...(required && { required: true }),
    ...(kind === 'objectId' && refFor(name, ctx)),
  };
}

/** `owner` / `ownerId` / `owners` next to a pulled `Owner` model → `ref: 'Owner'`. */
function refFor(field: string, ctx: Ctx): { ref?: string } {
  const base = singular(field.replace(/_?[Ii][Dd]s?$/, '')).toLowerCase();
  const model = ctx.models.get(base);
  return model ? { ref: model } : {};
}

function schemaOf(fields: Map<string, Shape>, total: number, prefix: string, ctx: Ctx): AnyRecord {
  const out: AnyRecord = {};
  for (const [k, shape] of fields) {
    const def = fieldDef(k, shape, total, prefix ? `${prefix}.${k}` : k, ctx);
    if (def !== undefined) out[k] = def;
  }
  return out;
}

export async function pullMongo(
  conn: MongooseNS.Connection,
  pluralize: (name: string) => string,
  opts: {
    sample?: number;
    /** Collection → model name to keep (existing models), instead of deriving it. */
    names?: Map<string, string>;
  } = {},
): Promise<{ models: ModelSource[]; skipped: string[] }> {
  const sampleSize = opts.sample ?? 1000;
  const db = conn.db!;
  const collections = (await db.listCollections({ type: 'collection' }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.') && !INTERNAL.has(n))
    .sort();

  const nameOf = new Map(
    collections.map((c) => [c, opts.names?.get(c) ?? (pascal(singular(c)) || 'Model')]),
  );
  const ctxModels = new Map([...nameOf.values()].map((m) => [m.toLowerCase(), m]));
  const models: ModelSource[] = [];
  const skipped: string[] = [];

  for (const collection of collections) {
    const name = nameOf.get(collection)!;
    if (!/^[A-Za-z]/.test(name)) {
      skipped.push(collection);
      continue;
    }
    const coll = db.collection(collection);
    // promoteValues: false keeps BSON numbers as Int32 / Double / Long objects — otherwise
    // the driver turns small longs into plain numbers and they'd be pulled as `number`.
    const docs = (await coll
      .aggregate([{ $sample: { size: sampleSize } }], { promoteValues: false })
      .toArray()) as AnyRecord[];
    const ctx: Ctx = { notes: [], models: ctxModels };
    const shapes = new Map<string, Shape>();
    for (const d of docs) observeObject(shapes, d);

    const idShape = shapes.get('_id');
    if (idShape && [...idShape.kinds.keys()].some((k) => k !== 'objectId')) {
      ctx.notes.push(
        '_id is not an ObjectId here; defineCollection creates ObjectId ids for new documents',
      );
    }
    shapes.delete('_id');
    shapes.delete('__v');

    // createdAt/updatedAt dates are what `timestamps` (on by default) maintains.
    const isDate = (k: string) => {
      const s = shapes.get(k);
      return !!s && s.kinds.size === 1 && s.kinds.has('date');
    };
    const options: AnyRecord = {};
    if (isDate('createdAt') && isDate('updatedAt')) {
      shapes.delete('createdAt');
      shapes.delete('updatedAt');
    } else {
      options['timestamps'] = false;
    }

    const fields = Object.entries(schemaOf(shapes, docs.length, '', ctx));

    // Refs the field names didn't reveal: the collection that holds every sampled id.
    for (const [field, def] of fields) {
      const d = def as AnyRecord;
      const holdsIds =
        d['type'] === 'objectId' || (d['type'] === 'array' && d['of'] === 'objectId');
      if (!holdsIds || d['ref'] !== undefined) continue;
      const ids = new Map<string, unknown>();
      for (const doc of docs) {
        for (const v of [doc[field]].flat()) {
          if (bsonKind(v) === 'objectId' && ids.size < 20) ids.set(String(v), v);
        }
      }
      if (ids.size === 0) continue;
      const holders: string[] = [];
      for (const other of collections) {
        const found = await db
          .collection(other)
          .countDocuments({ _id: { $in: [...ids.values()] } } as AnyRecord);
        if (found === ids.size) holders.push(other);
      }
      if (holders.length === 1) d['ref'] = nameOf.get(holders[0]!)!;
      else
        ctx.notes.push(
          `${field}: holds ObjectIds${holders.length ? ` found in ${holders.join(', ')}` : ''} — add ref: '<Model>' if it points at another collection`,
        );
    }

    // Indexes: single-field ones on the field, the rest in options.indexes.
    const indexes: AnyRecord[] = [];
    for (const ix of (await coll.indexes()) as AnyRecord[]) {
      if (ix['name'] === '_id_') continue;
      const key = ix['key'] as Record<string, unknown>;
      const textKeys = ix['weights'] ? Object.keys(ix['weights'] as AnyRecord) : [];
      const spec: Record<string, unknown> = textKeys.length
        ? Object.fromEntries(textKeys.map((k) => [k, 'text']))
        : key;
      const keys = Object.keys(spec);
      const simple =
        keys.length === 1 &&
        ix['partialFilterExpression'] === undefined &&
        ix['expireAfterSeconds'] === undefined &&
        !keys[0]!.includes('.');
      const field = simple ? fields.find(([f]) => f === keys[0]) : undefined;
      if (
        field &&
        !Array.isArray(field[1]) &&
        typeof (field[1] as AnyRecord)['type'] === 'string'
      ) {
        const def = field[1] as AnyRecord;
        const dir = spec[keys[0]!];
        if (ix['unique']) def['unique'] = true;
        else def['index'] = dir === '2dsphere' || dir === 'text' || dir === 'hashed' ? dir : true;
        continue;
      }
      indexes.push({
        fields: spec,
        ...(ix['unique'] === true && { unique: true }),
        ...(ix['partialFilterExpression'] !== undefined && {
          partialFilterExpression: ix['partialFilterExpression'],
        }),
        ...(ix['expireAfterSeconds'] !== undefined && {
          expireAfterSeconds: ix['expireAfterSeconds'],
        }),
      });
    }
    if (indexes.length) options['indexes'] = indexes;
    if (pluralize(name) !== collection) options['collection'] = collection;

    ctx.notes.unshift(
      docs.length
        ? `Pulled from ${docs.length} sampled document(s) of "${collection}": a field is required only when every sample had a value.`
        : `"${collection}" is empty — no fields could be inferred.`,
    );
    models.push({
      name,
      fields,
      options,
      notes: ctx.notes,
      api: 'defineCollection',
      table: collection,
    });
  }
  return { models, skipped };
}
