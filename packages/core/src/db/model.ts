import type { FieldDefinition, ModelSchema, ModelCRUD } from '../types.js';

type AnyRecord = Record<string, unknown> & { id: string };

function normalise(doc: Record<string, unknown>): AnyRecord {
  const id = doc['_id'] ? String(doc['_id']) : '';
  return { ...doc, id } as AnyRecord;
}

function isNestedArraySchema(def: FieldDefinition | [ModelSchema]): def is [ModelSchema] {
  return Array.isArray(def);
}

function primitiveCtor(type: FieldDefinition['type'], mg: typeof import('mongoose')): unknown {
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

function buildFieldEntry(def: FieldDefinition, mg: typeof import('mongoose')): Record<string, unknown> {
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
  if (def.default !== undefined) entry['default'] = def.default;
  if (def.enum !== undefined) entry['enum'] = def.enum;
  return entry;
}

function buildMongooseSchema(
  schema: ModelSchema,
  mg: typeof import('mongoose'),
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

async function getModel(
  name: string,
  schema: ModelSchema,
): Promise<import('mongoose').Model<Record<string, unknown>>> {
  let mg: typeof import('mongoose');
  try {
    const mod = await import('mongoose');
    mg = (mod.default || mod) as typeof import('mongoose');
  } catch {
    throw new Error('[EFC] mongoose is not installed. Run: npm install mongoose');
  }

  if (mg.models[name]) return mg.models[name] as import('mongoose').Model<Record<string, unknown>>;

  const schemaObj = buildMongooseSchema(schema, mg);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mongooseSchema = new mg.Schema(schemaObj as any, { timestamps: true });
  return mg.model<Record<string, unknown>>(name, mongooseSchema);
}

export function defineModel<T extends Record<string, any>>(
  name: string,
  schema: ModelSchema,
): ModelCRUD<T> {
  return {
    async find(filter = {}, options) {
      const M = await getModel(name, schema);
      const query = M.find(filter as Record<string, unknown>);
      if (options?.populate) query.populate(options.populate);
      const docs = await query.lean();
      return (docs as Record<string, unknown>[]).map(normalise) as (T & { id: string })[];
    },

    async findById(id, options) {
      const M = await getModel(name, schema);
      const query = M.findById(id);
      if (options?.populate) query.populate(options.populate);
      const doc = await query.lean();
      if (!doc) return null;
      return normalise(doc as Record<string, unknown>) as T & { id: string };
    },

    async findOne(filter, options) {
      const M = await getModel(name, schema);
      const query = M.findOne(filter as Record<string, unknown>);
      if (options?.populate) query.populate(options.populate);
      const doc = await query.lean();
      if (!doc) return null;
      return normalise(doc as Record<string, unknown>) as T & { id: string };
    },

    async create(data) {
      const M = await getModel(name, schema);
      const doc = await M.create(data);
      return normalise(doc.toObject() as Record<string, unknown>) as T & { id: string };
    },

    async update(id, data) {
      const M = await getModel(name, schema);
      const doc = await M.findByIdAndUpdate(id, data, { new: true }).lean();
      if (!doc) return null;
      return normalise(doc as Record<string, unknown>) as T & { id: string };
    },

    async delete(id) {
      const M = await getModel(name, schema);
      await M.findByIdAndDelete(id);
    },

    async count(filter = {}) {
      const M = await getModel(name, schema);
      return M.countDocuments(filter as Record<string, unknown>);
    },
  };
}
