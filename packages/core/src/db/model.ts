import { randomUUID, randomBytes } from 'node:crypto';
import type { FieldDefinition, ModelSchema, ModelCRUD, ModelOptions, DefaultOperator } from '../types.js';
import type * as MongooseNS from 'mongoose';
import { getCurrentUser } from '../context.js';

type AnyRecord = Record<string, unknown> & { id: string };

function normalise(doc: Record<string, unknown>): AnyRecord {
  const id = doc['_id'] ? String(doc['_id']) : '';
  return { ...doc, id } as AnyRecord;
}

// Codes that don't need the live mongoose instance to compute a value.
const STATIC_DEFAULT_OPERATORS: Record<string, () => unknown> = {
  $now: () => new Date(),
  $uuid: () => randomUUID(),
  $timestamp: () => Date.now(),
  $shortId: () => randomBytes(12).toString('base64url'),
};

const FIXED_DEFAULT_OPERATORS = new Set(['$now', '$uuid', '$objectId', '$timestamp', '$shortId']);

function isCurrentUserOperator(value: unknown): value is '$currentUser' | `$currentUser.${string}` {
  return typeof value === 'string' && (value === '$currentUser' || value.startsWith('$currentUser.'));
}

function isDefaultOperator(value: unknown): value is DefaultOperator {
  return (
    (typeof value === 'string' && FIXED_DEFAULT_OPERATORS.has(value)) || isCurrentUserOperator(value)
  );
}

// Mongoose calls function-valued `default`s per document, so resolving an operator
// code to its generator (rather than calling it once here) keeps values fresh per-insert
// (or, for $currentUser, per-request — read live from the AsyncLocalStorage context).
function resolveDefault(value: unknown, mg: typeof MongooseNS): unknown {
  if (!isDefaultOperator(value)) return value;
  if (value === '$objectId') return () => new mg.Types.ObjectId();
  if (value === '$currentUser') return () => getCurrentUser();
  if (isCurrentUserOperator(value)) {
    const key = value.slice('$currentUser.'.length);
    return () => getCurrentUser()?.[key];
  }
  return STATIC_DEFAULT_OPERATORS[value];
}

function isNestedArraySchema(def: FieldDefinition | [ModelSchema]): def is [ModelSchema] {
  return Array.isArray(def);
}

function primitiveCtor(type: FieldDefinition['type'], mg: typeof MongooseNS): unknown {
  switch (type) {
    case 'string':
      return String;
    case 'number':
      return Number;
    case 'boolean':
      return Boolean;
    case 'date':
      return Date;
    case 'object':
      return Object;
    case 'objectId':
      return mg.Schema.Types.ObjectId;
    case 'array':
      return Array;
  }
}

function buildFieldEntry(def: FieldDefinition, mg: typeof MongooseNS): Record<string, unknown> {
  const entry: Record<string, unknown> = {};

  if (def.type === 'array') {
    if (def.of === 'objectId') {
      const item: Record<string, unknown> = { type: mg.Schema.Types.ObjectId };
      if (def.ref !== undefined) item['ref'] = def.ref;
      entry['type'] = [item];
    } else if (def.of) {
      entry['type'] = [primitiveCtor(def.of, mg)];
    } else {
      entry['type'] = Array;
    }
  } else {
    entry['type'] = primitiveCtor(def.type, mg);
    if (def.type === 'objectId' && def.ref !== undefined) entry['ref'] = def.ref;
  }

  if (def.required !== undefined) entry['required'] = def.required;
  if (def.unique !== undefined) entry['unique'] = def.unique;
  if (def.default !== undefined) entry['default'] = resolveDefault(def.default, mg);
  if (def.enum !== undefined) entry['enum'] = def.enum;
  return entry;
}

function buildMongooseSchema(
  schema: ModelSchema,
  mg: typeof MongooseNS,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(schema)) {
    if (isNestedArraySchema(def)) {
      out[key] = def[0] ? [buildMongooseSchema(def[0], mg)] : [];
    } else {
      out[key] = buildFieldEntry(def, mg);
    }
  }
  return out;
}

interface SequenceField {
  path: string;
  key: string;
}

// `sequence` only applies to top-level fields — nested array sub-schemas are
// skipped, since resolving a per-subdocument counter path/isNew tracking isn't
// worth the complexity for what's meant to be a simple auto-increment.
function collectSequenceFields(name: string, schema: ModelSchema): SequenceField[] {
  const fields: SequenceField[] = [];
  for (const [path, def] of Object.entries(schema)) {
    if (isNestedArraySchema(def)) continue;
    if (def.sequence) {
      const key = typeof def.sequence === 'string' ? def.sequence : `${name}.${path}`;
      fields.push({ path, key });
    }
  }
  return fields;
}

const COUNTER_MODEL_NAME = '__EFCCounter__';

interface CounterDoc {
  _id: string;
  seq: number;
}

function getCounterModel(mg: typeof MongooseNS): MongooseNS.Model<CounterDoc> {
  if (mg.models[COUNTER_MODEL_NAME]) {
    return mg.models[COUNTER_MODEL_NAME] as MongooseNS.Model<CounterDoc>;
  }
  const counterSchema = new mg.Schema<CounterDoc>(
    { _id: { type: String, required: true }, seq: { type: Number, default: 0 } },
    { collection: 'efc_counters', versionKey: false },
  );
  return mg.model<CounterDoc>(COUNTER_MODEL_NAME, counterSchema);
}

// Atomic $inc + upsert — safe under concurrent inserts across workers/processes,
// since the increment happens inside MongoDB, not in application memory.
async function nextSequence(mg: typeof MongooseNS, key: string): Promise<number> {
  const Counter = getCounterModel(mg);
  const doc = await Counter.findByIdAndUpdate(
    key,
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true },
  ).lean();
  return (doc as unknown as CounterDoc).seq;
}

async function getModel(
  name: string,
  schema: ModelSchema,
  options: ModelOptions = {},
): Promise<MongooseNS.Model<Record<string, unknown>>> {
  let mg: typeof MongooseNS;
  try {
    const mod = await import('mongoose');
    mg = (mod.default || mod) as typeof MongooseNS;
  } catch {
    throw new Error('[EFC] mongoose is not installed. Run: npm install mongoose');
  }

  if (mg.models[name]) return mg.models[name] as MongooseNS.Model<Record<string, unknown>>;

  const schemaObj = buildMongooseSchema(schema, mg);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mongooseSchema = new mg.Schema(schemaObj as any, { timestamps: options.timestamps ?? true });

  const sequenceFields = collectSequenceFields(name, schema);
  if (sequenceFields.length > 0) {
    // pre('validate'), not pre('save') — mongoose validates required fields
    // before the 'save' hook chain runs, so assigning here (before validation)
    // is the only way a sequence field can also be `required: true`.
    mongooseSchema.pre('validate', async function (this: MongooseNS.Document) {
      if (!this.isNew) return;
      for (const { path, key } of sequenceFields) {
        if (this.get(path) == null) {
          this.set(path, await nextSequence(mg, key));
        }
      }
    });
  }

  return mg.model<Record<string, unknown>>(name, mongooseSchema);
}

export function defineModel<T extends object>(
  name: string,
  schema: ModelSchema,
  options?: ModelOptions,
): ModelCRUD<T> {
  return {
    async find(filter = {}, queryOptions) {
      const M = await getModel(name, schema, options);
      const query = M.find(filter as Record<string, unknown>);
      if (queryOptions?.populate) query.populate(queryOptions.populate);
      const docs = await query.lean();
      return (docs as Record<string, unknown>[]).map(normalise) as (T & { id: string })[];
    },

    async findById(id, queryOptions) {
      const M = await getModel(name, schema, options);
      const query = M.findById(id);
      if (queryOptions?.populate) query.populate(queryOptions.populate);
      const doc = await query.lean();
      if (!doc) return null;
      return normalise(doc as Record<string, unknown>) as T & { id: string };
    },

    async findOne(filter, queryOptions) {
      const M = await getModel(name, schema, options);
      const query = M.findOne(filter as Record<string, unknown>);
      if (queryOptions?.populate) query.populate(queryOptions.populate);
      const doc = await query.lean();
      if (!doc) return null;
      return normalise(doc as Record<string, unknown>) as T & { id: string };
    },

    async create(data) {
      const M = await getModel(name, schema, options);
      const doc = await M.create(data);
      return normalise(doc.toObject() as Record<string, unknown>) as T & { id: string };
    },

    async update(id, data) {
      const M = await getModel(name, schema, options);
      const doc = await M.findByIdAndUpdate(id, data, { returnDocument: 'after' }).lean();
      if (!doc) return null;
      return normalise(doc as Record<string, unknown>) as T & { id: string };
    },

    async delete(id) {
      const M = await getModel(name, schema, options);
      await M.findByIdAndDelete(id);
    },

    async count(filter = {}) {
      const M = await getModel(name, schema, options);
      return M.countDocuments(filter as Record<string, unknown>);
    },
  };
}
