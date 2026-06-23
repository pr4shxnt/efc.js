import type { ModelSchema, ModelCRUD } from '../types.js';

type AnyRecord = Record<string, unknown> & { id: string };

function normalise(doc: Record<string, unknown>): AnyRecord {
  const id = doc['_id'] ? String(doc['_id']) : '';
  return { ...doc, id } as AnyRecord;
}

async function getModel(
  name: string,
  schemaObj: Record<string, unknown>,
): Promise<import('mongoose').Model<Record<string, unknown>>> {
  let mg: typeof import('mongoose');
  try {
    const mod = await import('mongoose');
    mg = (mod.default || mod) as typeof import('mongoose');
  } catch {
    throw new Error('[EFC] mongoose is not installed. Run: npm install mongoose');
  }

  if (mg.models[name]) return mg.models[name] as import('mongoose').Model<Record<string, unknown>>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schema = new mg.Schema(schemaObj as any, { timestamps: true });
  return mg.model<Record<string, unknown>>(name, schema);
}

function buildMongooseSchema(schema: ModelSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(schema)) {
    const entry: Record<string, unknown> = {};
    switch (def.type) {
      case 'string':
        entry['type'] = String;
        break;
      case 'number':
        entry['type'] = Number;
        break;
      case 'boolean':
        entry['type'] = Boolean;
        break;
      case 'date':
        entry['type'] = Date;
        break;
      case 'object':
        entry['type'] = Object;
        break;
      case 'array':
        entry['type'] = Array;
        break;
    }
    if (def.required !== undefined) entry['required'] = def.required;
    if (def.unique !== undefined) entry['unique'] = def.unique;
    if (def.default !== undefined) entry['default'] = def.default;
    out[key] = entry;
  }
  return out;
}

export function defineModel<T extends Record<string, any>>(
  name: string,
  schema: ModelSchema,
): ModelCRUD<T> {
  const mongooseSchema = buildMongooseSchema(schema);

  return {
    async find(filter = {}) {
      const M = await getModel(name, mongooseSchema);
      const docs = await M.find(filter as Record<string, unknown>).lean();
      return (docs as Record<string, unknown>[]).map(normalise) as (T & { id: string })[];
    },

    async findById(id) {
      const M = await getModel(name, mongooseSchema);
      const doc = await M.findById(id).lean();
      if (!doc) return null;
      return normalise(doc as Record<string, unknown>) as T & { id: string };
    },

    async findOne(filter) {
      const M = await getModel(name, mongooseSchema);
      const doc = await M.findOne(filter as Record<string, unknown>).lean();
      if (!doc) return null;
      return normalise(doc as Record<string, unknown>) as T & { id: string };
    },

    async create(data) {
      const M = await getModel(name, mongooseSchema);
      const doc = await M.create(data);
      return normalise(doc.toObject() as Record<string, unknown>) as T & { id: string };
    },

    async update(id, data) {
      const M = await getModel(name, mongooseSchema);
      const doc = await M.findByIdAndUpdate(id, data, { new: true }).lean();
      if (!doc) return null;
      return normalise(doc as Record<string, unknown>) as T & { id: string };
    },

    async delete(id) {
      const M = await getModel(name, mongooseSchema);
      await M.findByIdAndDelete(id);
    },

    async count(filter = {}) {
      const M = await getModel(name, mongooseSchema);
      return M.countDocuments(filter as Record<string, unknown>);
    },
  };
}
