/* eslint-disable @typescript-eslint/no-explicit-any -- drizzle is an optional peer, loaded dynamically */
import { randomUUID } from 'node:crypto';
import type { FindOptions, ModelOptions, ModelQueryOptions } from '../types.js';
import { HttpError } from '../errors.js';
import {
  applyDefaults,
  ModelValidationError,
  refFields,
  sequenceFields,
  timestampFields,
  validateTree,
  validateAtPath,
  nodeAt,
  type FieldIssue,
  type FieldNode,
  type SchemaTree,
} from './schema.js';
import { currentTx, getRegisteredModel, isAutoSync } from './engine.js';
import { getOrm, getPool } from './postgres.js';
import { getLogger } from '../logger.js';
import type { EngineModel } from './mongo-model.js';

type AnyRecord = Record<string, unknown>;

interface Drizzle {
  sql: any;
  pgCore: any;
}

let drizzlePromise: Promise<Drizzle> | undefined;

function loadDrizzle(): Promise<Drizzle> {
  drizzlePromise ??= Promise.all([import('drizzle-orm'), import('drizzle-orm/pg-core')])
    .then(([orm, pgCore]) => ({ sql: (orm as any).sql, pgCore }))
    .catch(() => {
      drizzlePromise = undefined;
      throw new Error('[EFC] drizzle-orm is not installed. Run: npm install pg drizzle-orm');
    });
  return drizzlePromise;
}

/** mongoose-style collection naming so both engines agree: User → users, Category → categories. */
export function tableNameFor(model: string): string {
  const lower = model.toLowerCase();
  if (/[^aeiou]y$/.test(lower)) return lower.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/.test(lower)) return lower + 'es';
  return lower + 's';
}

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;
const sequenceName = (key: string) => `efc_seq_${key.replace(/[^A-Za-z0-9_]/g, '_').toLowerCase()}`;

type ColumnKind = 'text' | 'double' | 'bigint' | 'boolean' | 'timestamptz' | 'uuid' | 'jsonb';

function columnKind(node: FieldNode): ColumnKind {
  if (node.kind !== 'scalar') return 'jsonb';
  if (node.def.sequence) return 'bigint';
  switch (node.type) {
    case 'string':
      return 'text';
    case 'number':
      return 'double';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'timestamptz';
    case 'objectId':
      return 'uuid';
  }
}

const SQL_TYPE: Record<ColumnKind, string> = {
  text: 'text',
  double: 'double precision',
  bigint: 'bigint',
  boolean: 'boolean',
  timestamptz: 'timestamptz',
  uuid: 'uuid',
  jsonb: 'jsonb',
};

function literal(v: string | number): string {
  return typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`;
}

export function pgModel<T extends object>(
  name: string,
  tree: SchemaTree,
  options: ModelOptions,
): EngineModel<T> {
  const table = options.collection ?? tableNameFor(name);
  const ts = timestampFields(options);
  const sequences = sequenceFields(name, tree);
  const sequenceKeys = new Map(sequences.map((s) => [s.path, s.key]));
  const refs = refFields(tree);
  const columns = new Map<string, ColumnKind>([['id', 'uuid']]);
  for (const [key, node] of Object.entries(tree)) columns.set(key, columnKind(node));
  if (ts.createdAt) columns.set(ts.createdAt, 'timestamptz');
  if (ts.updatedAt) columns.set(ts.updatedAt, 'timestamptz');

  let compiled: Promise<{ t: any; sql: any }> | undefined;
  const compile = () =>
    (compiled ??= loadDrizzle().then(({ sql, pgCore }) => {
      const cols: AnyRecord = {};
      for (const [key, kind] of columns) {
        const c =
          kind === 'text'
            ? pgCore.text(key)
            : kind === 'double'
              ? pgCore.doublePrecision(key)
              : kind === 'bigint'
                ? pgCore.bigint(key, { mode: 'number' })
                : kind === 'boolean'
                  ? pgCore.boolean(key)
                  : kind === 'timestamptz'
                    ? pgCore.timestamp(key, { withTimezone: true, mode: 'date' })
                    : kind === 'uuid'
                      ? pgCore.uuid(key)
                      : pgCore.jsonb(key);
        cols[key] = key === 'id' ? c.primaryKey().defaultRandom() : c;
      }
      return { t: pgCore.pgTable(table, cols), sql };
    }));

  // Like MongoDB creating collections and indexes on first use: the first query through
  // this model reconciles its table (unless autoSync is off). Memoised per process; a
  // failure is retried on the next use instead of being cached.
  let synced: Promise<void> | undefined;
  const ready = async () => {
    const compiled = await compile();
    if (isAutoSync()) {
      synced ??= reconcile(false).then(
        (changes) => {
          if (changes.length)
            getLogger().info({ table, changes: changes.length }, `Synced table ${table}`);
        },
        (err: unknown) => {
          synced = undefined;
          throw err;
        },
      );
      await synced;
    }
    return compiled;
  };

  const client = () => {
    const tx = currentTx();
    return tx?.engine === 'postgresql' ? tx.tx : getOrm();
  };

  // ── filters ────────────────────────────────────────────────────────────────

  const columnFor = (t: any, field: string) => {
    if (!columns.has(field))
      throw new ModelValidationError(name, [{ path: field, message: 'unknown field' }]);
    return t[field];
  };

  const toDb = (field: string, value: unknown): unknown =>
    columns.get(field) === 'timestamptz' && value != null && !(value instanceof Date)
      ? new Date(value as string)
      : value;

  // A field the model doesn't declare behaves like a field absent from every document
  // (mongoose's strictQuery: false): equality with null / $exists: false / $ne match,
  // everything else doesn't.
  function missingField(sql: any, cond: unknown): any {
    const ops =
      cond !== null &&
      typeof cond === 'object' &&
      !Array.isArray(cond) &&
      !(cond instanceof Date) &&
      !(cond instanceof RegExp)
        ? (cond as AnyRecord)
        : { $eq: cond };
    const matches = Object.entries(ops).every(([op, v]) => {
      switch (op) {
        case '$eq':
          return v === null;
        case '$ne':
          return v !== null;
        case '$exists':
          return v === false;
        case '$in':
          return (v as unknown[]).includes(null);
        case '$nin':
          return !(v as unknown[]).includes(null);
        default:
          return false;
      }
    });
    return matches ? sql`true` : sql`false`;
  }

  function condition(sql: any, t: any, path: string, cond: unknown): any {
    const [field, ...rest] = path.split('.');
    if (!columns.has(field!)) return missingField(sql, cond);
    const col = columnFor(t, field!);
    const kind = columns.get(field!);
    const isOps =
      cond != null &&
      typeof cond === 'object' &&
      !Array.isArray(cond) &&
      !(cond instanceof Date) &&
      !(cond instanceof RegExp) &&
      Object.keys(cond).some((k) => k.startsWith('$'));

    // Expression for the compared value: a column, or a text/number extraction from jsonb.
    const jsonPath = rest.length > 0 ? `{${rest.join(',')}}` : undefined;
    const exprFor = (sample: unknown) =>
      jsonPath === undefined
        ? col
        : typeof sample === 'number'
          ? sql`((${col} #>> ${jsonPath})::double precision)`
          : typeof sample === 'boolean'
            ? sql`((${col} #>> ${jsonPath})::boolean)`
            : sql`(${col} #>> ${jsonPath})`;

    const eqCond = (v: unknown) => {
      if (v === null) return jsonPath ? sql`(${col} #> ${jsonPath}) is null` : sql`${col} is null`;
      if (kind === 'jsonb' && jsonPath === undefined) {
        // Array fields match when they contain the value (MongoDB semantics); objects match exactly.
        return Array.isArray(v) || (typeof v === 'object' && !(v instanceof Date))
          ? sql`${col} = ${JSON.stringify(v)}::jsonb`
          : sql`${col} @> ${JSON.stringify([v])}::jsonb`;
      }
      return sql`${exprFor(v)} = ${jsonPath ? v : toDb(field!, v)}`;
    };

    if (!isOps) return eqCond(cond);

    const parts: any[] = [];
    for (const [op, v] of Object.entries(cond as AnyRecord)) {
      const e = exprFor(Array.isArray(v) ? v[0] : v);
      const val = jsonPath ? v : toDb(field!, v);
      switch (op) {
        case '$eq':
          parts.push(eqCond(v));
          break;
        case '$ne':
          if (v === null) parts.push(sql`${e} is not null`);
          else if (kind === 'jsonb' && !jsonPath) {
            // Array fields: "does not contain" (MongoDB semantics); objects: not equal.
            parts.push(
              Array.isArray(v) || (typeof v === 'object' && !(v instanceof Date))
                ? sql`(${col} is null or ${col} <> ${JSON.stringify(v)}::jsonb)`
                : sql`(${col} is null or not (${col} @> ${JSON.stringify([v])}::jsonb))`,
            );
          } else parts.push(sql`(${e} is null or ${e} <> ${val})`);
          break;
        case '$gt':
          parts.push(sql`${e} > ${val}`);
          break;
        case '$gte':
          parts.push(sql`${e} >= ${val}`);
          break;
        case '$lt':
          parts.push(sql`${e} < ${val}`);
          break;
        case '$lte':
          parts.push(sql`${e} <= ${val}`);
          break;
        case '$in':
        case '$nin': {
          const list = (v as unknown[]).map((x) => (jsonPath ? x : toDb(field!, x)));
          if (list.length === 0) {
            parts.push(op === '$in' ? sql`false` : sql`true`);
            break;
          }
          const inList =
            kind === 'jsonb' && !jsonPath
              ? sql.join(
                  list.map((x) => sql`${col} @> ${JSON.stringify([x])}::jsonb`),
                  sql` or `,
                )
              : sql`${e} in (${sql.join(
                  list.map((x) => sql`${x}`),
                  sql`, `,
                )})`;
          parts.push(
            op === '$in'
              ? sql`(${inList})`
              : sql`(${kind === 'jsonb' && !jsonPath ? sql`${col} is null or ` : sql``}not (${inList}))`,
          );
          break;
        }
        case '$exists':
          parts.push(
            v ? sql`${exprFor(undefined)} is not null` : sql`${exprFor(undefined)} is null`,
          );
          break;
        case '$regex': {
          const re = v instanceof RegExp ? v : new RegExp(String(v));
          const textExpr = jsonPath ? sql`(${col} #>> ${jsonPath})` : col;
          parts.push(
            re.flags.includes('i')
              ? sql`${textExpr} ~* ${re.source}`
              : sql`${textExpr} ~ ${re.source}`,
          );
          break;
        }
        default:
          throw new ModelValidationError(name, [
            { path, message: `operator ${op} is not supported on PostgreSQL` },
          ]);
      }
    }
    return parts.length === 1 ? parts[0] : sql`(${sql.join(parts, sql` and `)})`;
  }

  function where(sql: any, t: any, filter: AnyRecord | undefined): any {
    if (!filter) return undefined;
    const parts: any[] = [];
    for (const [k, v] of Object.entries(filter)) {
      if (v === undefined) continue;
      if (k === '$and' || k === '$or') {
        const sub = (v as AnyRecord[]).map((f) => where(sql, t, f) ?? sql`true`);
        if (sub.length) parts.push(sql`(${sql.join(sub, k === '$and' ? sql` and ` : sql` or `)})`);
      } else {
        parts.push(condition(sql, t, k, v));
      }
    }
    return parts.length === 0
      ? undefined
      : parts.length === 1
        ? parts[0]
        : sql.join(parts, sql` and `);
  }

  // ── records ────────────────────────────────────────────────────────────────

  // NULL columns are dropped so records look like MongoDB's: unset fields are absent.
  const fromRow = (row: AnyRecord): AnyRecord => {
    const out: AnyRecord = {};
    for (const [k, v] of Object.entries(row)) if (v !== null) out[k] = v;
    return out;
  };

  const validate = async (data: AnyRecord, partial: boolean) => {
    const issues: FieldIssue[] = [];
    const checkTree: SchemaTree = {};
    for (const [k, node] of Object.entries(tree)) {
      // The database assigns sequence values, so they can't be "missing" on insert.
      checkTree[k] = sequenceKeys.has(k)
        ? ({ ...node, def: { ...node.def, required: false } } as FieldNode)
        : node;
    }
    await validateTree(checkTree, data, issues, partial);
    if (issues.length) throw new ModelValidationError(name, issues);
  };

  // Undeclared fields are dropped silently on every write (mongoose's strict mode).
  const known = (data: AnyRecord): AnyRecord =>
    Object.fromEntries(Object.entries(data).filter(([k]) => columns.has(k.split('.')[0]!)));

  const prepareInsert = async (input: AnyRecord): Promise<AnyRecord> => {
    const { id, ...rest } = known(input);
    const data = applyDefaults(tree, rest, randomUUID);
    await validate(data, false);
    const now = new Date();
    if (ts.createdAt) data[ts.createdAt] = now;
    if (ts.updatedAt) data[ts.updatedAt] = now;
    if (id !== undefined) data['id'] = id;
    for (const [k, v] of Object.entries(data)) data[k] = toDb(k, v);
    return data;
  };

  async function populate(records: AnyRecord[], paths: string | string[] | undefined) {
    if (!paths) return records;
    for (const path of Array.isArray(paths) ? paths : [paths]) {
      const ref = refs.get(path);
      if (!ref)
        throw new ModelValidationError(name, [{ path, message: 'is not a populatable ref field' }]);
      const target = getRegisteredModel(ref.model);
      if (!target) throw new Error(`[EFC] populate: model "${ref.model}" is not defined`);
      const ids = [
        ...new Set(
          records.flatMap((r) =>
            ref.many ? ((r[path] as string[]) ?? []) : r[path] ? [r[path] as string] : [],
          ),
        ),
      ];
      if (ids.length === 0) continue;
      const byId = new Map(
        (await target.find({ id: { $in: ids } } as never)).map((d) => [d.id, d]),
      );
      for (const r of records) {
        if (ref.many) r[path] = ((r[path] as string[]) ?? []).map((id) => byId.get(id) ?? id);
        else if (r[path]) r[path] = byId.get(r[path] as string) ?? r[path];
      }
    }
    return records;
  }

  const selection = (t: any, select: string[] | undefined) => {
    if (!select) return undefined;
    const out: AnyRecord = { id: t.id };
    for (const f of select) if (columns.has(f)) out[f] = columnFor(t, f);
    return out;
  };

  async function runFind(
    filter: AnyRecord | undefined,
    opts: FindOptions | undefined,
  ): Promise<AnyRecord[]> {
    const { t, sql } = await ready();
    const sel = selection(t, opts?.select);
    let query = (sel ? client().select(sel) : client().select()).from(t);
    const w = where(sql, t, filter);
    if (w) query = query.where(w);
    if (opts?.sort) {
      const order = Object.entries(opts.sort)
        .filter(([f]) => columns.has(f))
        .map(([f, dir]) => {
          const col = columnFor(t, f);
          return dir === -1 || dir === 'desc'
            ? sql`${col} desc nulls last`
            : sql`${col} asc nulls first`;
        });
      if (order.length) query = query.orderBy(...order);
    }
    if (opts?.limit !== undefined) query = query.limit(opts.limit);
    if (opts?.skip !== undefined) query = query.offset(opts.skip);
    const rows = ((await query) as AnyRecord[]).map(fromRow);
    return populate(rows, opts?.populate);
  }

  // ── updates ────────────────────────────────────────────────────────────────

  // Drops undeclared fields from an update, at the top level and inside operators —
  // including dotted paths the nested schema doesn't have (mongoose's strict mode).
  const strictUpdate = (update: AnyRecord): AnyRecord => {
    const declared = (path: string) =>
      columns.has(path.split('.')[0]!) &&
      (!path.includes('.') || nodeAt(tree, path.split('.')) !== undefined);
    const out: AnyRecord = {};
    for (const [k, v] of Object.entries(update)) {
      if (k.startsWith('$') && v !== null && typeof v === 'object') {
        out[k] = Object.fromEntries(Object.entries(v as AnyRecord).filter(([p]) => declared(p)));
      } else if (k.startsWith('$') || declared(k)) out[k] = v;
    }
    return out;
  };

  async function buildSet(input: AnyRecord): Promise<AnyRecord> {
    const { t, sql } = await compile();
    const update = strictUpdate(input);
    const ops = update as Record<string, AnyRecord | undefined>;
    for (const op of Object.keys(update).filter((k) => k.startsWith('$'))) {
      if (!['$set', '$unset', '$inc', '$push', '$pull'].includes(op)) {
        throw new ModelValidationError(name, [
          { path: op, message: 'update operator is not supported on PostgreSQL' },
        ]);
      }
    }
    const plain: AnyRecord = {};
    for (const [k, v] of Object.entries(update)) if (!k.startsWith('$')) plain[k] = v;
    const $set: AnyRecord = { ...(ops['$set'] ?? {}), ...plain };

    // Validate: top-level fields with the partial-update rules, dotted paths against the
    // schema node they target (MongoDB's runValidators covers both on that engine).
    const issues: FieldIssue[] = [];
    const topLevel: AnyRecord = {};
    for (const [k, v] of Object.entries($set)) if (!k.includes('.')) topLevel[k] = v;
    for (const k of Object.keys(ops['$unset'] ?? {})) if (!k.includes('.')) topLevel[k] = null;
    for (const [k, v] of Object.entries($set))
      if (k.includes('.')) await validateAtPath(tree, k, v, issues);
    for (const k of Object.keys(ops['$unset'] ?? {})) {
      if (k.includes('.')) await validateAtPath(tree, k, null, issues);
    }
    for (const [k, by] of Object.entries(ops['$inc'] ?? {})) {
      if (typeof by !== 'number') issues.push({ path: k, message: '$inc needs a number' });
      const node = k.includes('.') ? nodeAt(tree, k.split('.')) : tree[k];
      if (node && !(node.kind === 'scalar' && node.type === 'number') && node.kind !== 'json') {
        issues.push({ path: k, message: '$inc only applies to number fields' });
      }
    }
    if (issues.length) throw new ModelValidationError(name, issues);
    await validate(topLevel, true);

    // Each touched column gets one expression; dotted operations on the same jsonb column
    // compose onto it in order instead of overwriting each other.
    const set: AnyRecord = {};
    const nested = new Map<string, unknown>();
    const touchedTop = new Set<string>();
    const acc = (field: string) => (nested.get(field) ?? columnFor(t, field)) as unknown;
    const conflict = (path: string) => {
      throw new ModelValidationError(name, [{ path, message: 'conflicting update paths' }]);
    };
    const top = (field: string, value: unknown) => {
      if (touchedTop.has(field) || nested.has(field)) conflict(field);
      touchedTop.add(field);
      set[field] = value;
    };
    // jsonb_set only creates the last key of a path; build missing parents first, as MongoDB does.
    const withParents = (base: unknown, parts: string[]) => {
      let expr = sql`coalesce(${base}, '{}'::jsonb)`;
      for (let i = 1; i < parts.length; i++) {
        const prefix = `{${parts.slice(0, i).join(',')}}`;
        expr = sql`jsonb_set(${expr}, ${prefix}, coalesce(${expr} #> ${prefix}, '{}'::jsonb), true)`;
      }
      return expr;
    };
    const dotted = (path: string, apply: (base: unknown, jsonPath: string) => unknown) => {
      const [field, ...rest] = path.split('.');
      if (touchedTop.has(field!)) conflict(path);
      columnFor(t, field!);
      const base = withParents(acc(field!), rest);
      nested.set(field!, apply(base, `{${rest.join(',')}}`));
    };
    const items = (v: unknown) =>
      JSON.stringify(
        v != null && typeof v === 'object' && '$each' in (v as AnyRecord)
          ? (v as { $each: unknown[] }).$each
          : [v],
      );

    for (const [k, v] of Object.entries($set)) {
      if (k.includes('.'))
        dotted(k, (b, p) => sql`jsonb_set(${b}, ${p}, ${JSON.stringify(v)}::jsonb, true)`);
      else top(k, toDb(k, v));
    }
    for (const k of Object.keys(ops['$unset'] ?? {})) {
      if (k.includes('.')) dotted(k, (b, p) => sql`(${b} #- ${p})`);
      else top(k, null);
    }
    for (const [k, by] of Object.entries(ops['$inc'] ?? {})) {
      if (k.includes('.')) {
        dotted(
          k,
          (b, p) =>
            sql`jsonb_set(${b}, ${p}, to_jsonb(coalesce((${b} #>> ${p})::double precision, 0) + ${by as number}), true)`,
        );
      } else top(k, sql`coalesce(${columnFor(t, k)}, 0) + ${by as number}`);
    }
    for (const [k, v] of Object.entries(ops['$push'] ?? {})) {
      if (k.includes('.')) {
        dotted(
          k,
          (b, p) =>
            sql`jsonb_set(${b}, ${p}, coalesce(${b} #> ${p}, '[]'::jsonb) || ${items(v)}::jsonb, true)`,
        );
      } else top(k, sql`coalesce(${columnFor(t, k)}, '[]'::jsonb) || ${items(v)}::jsonb`);
    }
    for (const [k, v] of Object.entries(ops['$pull'] ?? {})) {
      const without = (arr: unknown) =>
        sql`coalesce((select jsonb_agg(e) from jsonb_array_elements(${arr}) e where e <> ${JSON.stringify(v)}::jsonb), '[]'::jsonb)`;
      if (k.includes('.'))
        dotted(k, (b, p) => sql`jsonb_set(${b}, ${p}, ${without(sql`(${b} #> ${p})`)}, true)`);
      else top(k, without(columnFor(t, k)));
    }
    for (const [field, expr] of nested) set[field] = expr;
    if (ts.updatedAt) set[ts.updatedAt] = new Date();
    return set;
  }

  const guard = async <R>(fn: () => Promise<R>): Promise<R> => {
    try {
      return await fn();
    } catch (err) {
      const e =
        (err as { cause?: { code?: string; detail?: string; column?: string } }).cause ??
        (err as { code?: string; detail?: string });
      if (e?.code === '42P01') {
        throw new Error(
          `[EFC] ${name}: table "${table}" does not exist — autoSync is off, so create it with a migration (Model.sync() / efc db sync)`,
        );
      }
      if (e?.code === '23505') {
        const field = /\(([^)]+)\)=/.exec(e.detail ?? '')?.[1] ?? 'field';
        throw new HttpError(409, `${name} with this ${field.replace(/"/g, '')} already exists`);
      }
      if (e?.code === '23502')
        throw new ModelValidationError(name, [
          { path: (e as { column?: string }).column ?? '', message: 'is required' },
        ]);
      if (e?.code === '22P02')
        throw new ModelValidationError(name, [{ path: '', message: 'invalid value' }]);
      throw err;
    }
  };

  // ── schema reconciliation ────────────────────────────────────────────────────
  // Brings the table in line with the model the way MongoDB "just works" when a schema
  // changes: create what's missing, convert changed column types, relax constraints the
  // model no longer asks for, rebuild enum checks, drop indexes EFC created that the
  // model no longer declares. Never drops a column or a row. Validation (required,
  // enum, ...) stays in the model, as on MongoDB — the database only keeps types,
  // uniqueness and enum checks, so editing a model can't strand existing rows.

  const FORMATTED: Record<ColumnKind, string> = {
    text: 'text',
    double: 'double precision',
    bigint: 'bigint',
    boolean: 'boolean',
    timestamptz: 'timestamp with time zone',
    uuid: 'uuid',
    jsonb: 'jsonb',
  };

  // USING expression converting an existing column to the model's type.
  const castExpr = (col: string, from: string, to: ColumnKind): string => {
    const c = q(col);
    if (to === 'jsonb') return `to_jsonb(${c})`;
    const scalar = from === 'jsonb' ? `(${c} #>> '{}')` : c;
    if (to === 'bigint') return `round(${scalar}::numeric)::bigint`;
    return `${scalar}::${SQL_TYPE[to]}`;
  };

  const enumCheck = (key: string) => `${table}_${key}_enum`;
  const managedIndexName = /_(key|idx)$/;

  function desiredIndexes(): Map<string, string> {
    const out = new Map<string, string>();
    for (const [key, node] of Object.entries(tree)) {
      if (node.def.unique) {
        out.set(
          `${table}_${key}_key`,
          `CREATE UNIQUE INDEX ${q(`${table}_${key}_key`)} ON ${q(table)} (${q(key)})`,
        );
      } else if (node.def.index) {
        out.set(
          `${table}_${key}_idx`,
          `CREATE INDEX ${q(`${table}_${key}_idx`)} ON ${q(table)} (${q(key)})`,
        );
      }
    }
    for (const idx of options.indexes ?? []) {
      const fields = Object.entries(idx.fields);
      if (idx.expireAfterSeconds !== undefined) {
        throw new Error(`[EFC] ${name}: TTL indexes (expireAfterSeconds) are MongoDB-only`);
      }
      const idxName =
        idx.name ?? `${table}_${fields.map(([f]) => f).join('_')}_${idx.unique ? 'key' : 'idx'}`;
      if (fields.some(([, d]) => d === 'text')) {
        const doc = fields.map(([f]) => `coalesce(${q(f)}::text, '')`).join(` || ' ' || `);
        out.set(
          idxName,
          `CREATE INDEX ${q(idxName)} ON ${q(table)} USING gin (to_tsvector('simple', ${doc}))`,
        );
      } else {
        const cols = fields.map(([f, d]) => `${q(f)} ${d === -1 ? 'DESC' : 'ASC'}`).join(', ');
        out.set(
          idxName,
          `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX ${q(idxName)} ON ${q(table)} (${cols})`,
        );
      }
    }
    return out;
  }

  async function reconcile(dryRun: boolean): Promise<string[]> {
    const pool = getPool();
    const conn = await pool.connect();
    try {
      await conn.query('BEGIN');
      // Serialises concurrent syncs of this table (every cluster worker runs one on boot).
      await conn.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`efc_sync:${table}`]);

      const existing = new Map<string, { type: string; nullable: boolean }>(
        (
          await conn.query<{ name: string; type: string; nullable: boolean }>(
            `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable
             FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = $1 AND n.nspname = current_schema() AND a.attnum > 0 AND NOT a.attisdropped`,
            [table],
          )
        ).rows.map((r) => [r.name, { type: r.type, nullable: r.nullable }]),
      );
      const checks = new Map<string, string>(
        (
          await conn.query<{ name: string; def: string }>(
            `SELECT con.conname AS name, pg_get_constraintdef(con.oid) AS def
             FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = $1 AND n.nspname = current_schema() AND con.contype = 'c'`,
            [table],
          )
        ).rows.map((r) => [r.name, r.def]),
      );
      const indexes = new Set(
        (
          await conn.query<{ name: string }>(
            `SELECT indexname AS name FROM pg_indexes WHERE tablename = $1 AND schemaname = current_schema()`,
            [table],
          )
        ).rows.map((r) => r.name),
      );

      const plan: string[] = [];
      for (const { key } of sequences) {
        const seq = sequenceName(key);
        const found = await conn.query(
          'SELECT 1 FROM pg_class WHERE relkind = $1 AND relname = $2',
          ['S', seq],
        );
        if (found.rowCount === 0) plan.push(`CREATE SEQUENCE IF NOT EXISTS ${q(seq)}`);
      }

      const columnSql = (key: string, kind: ColumnKind) => {
        const seq = sequenceKeys.get(key);
        return `${q(key)} ${SQL_TYPE[kind]}${seq ? ` DEFAULT nextval('${sequenceName(seq)}')` : ''}`;
      };

      if (existing.size === 0) {
        const defs = [...columns].map(([key, kind]) =>
          key === 'id'
            ? `${q('id')} uuid PRIMARY KEY DEFAULT gen_random_uuid()`
            : columnSql(key, kind),
        );
        plan.push(`CREATE TABLE IF NOT EXISTS ${q(table)} (\n  ${defs.join(',\n  ')}\n)`);
      } else {
        for (const [key, kind] of columns) {
          const col = existing.get(key);
          if (!col) {
            plan.push(`ALTER TABLE ${q(table)} ADD COLUMN ${columnSql(key, kind)}`);
          } else if (key !== 'id' && col.type !== FORMATTED[kind]) {
            plan.push(
              `ALTER TABLE ${q(table)} ALTER COLUMN ${q(key)} TYPE ${SQL_TYPE[kind]} USING ${castExpr(key, col.type, kind)}`,
            );
          }
        }
        // NOT NULL is the model's job (validation), as on MongoDB: relax any left over from
        // an older model or an earlier EFC version, so dropping/loosening a field never
        // breaks inserts. Columns the model no longer declares are kept, just optional.
        for (const [key, col] of existing) {
          if (key !== 'id' && !col.nullable) {
            plan.push(`ALTER TABLE ${q(table)} ALTER COLUMN ${q(key)} DROP NOT NULL`);
          }
        }
      }

      // Enum checks: one managed constraint per enum field, rebuilt when the values change.
      // NOT VALID: like MongoDB, existing rows aren't re-validated against a new enum.
      const wantedChecks = new Map<string, string>();
      for (const [key, node] of Object.entries(tree)) {
        if (node.kind === 'scalar' && node.def.enum) {
          wantedChecks.set(
            enumCheck(key),
            `CHECK (${q(key)} IN (${node.def.enum.map(literal).join(', ')}))`,
          );
        }
      }
      for (const [con, def] of checks) {
        const legacy = con.endsWith('_check') && con.startsWith(`${table}_`); // inline CHECKs from older EFC
        if (
          (con.endsWith('_enum') && con.startsWith(`${table}_`) && !wantedChecks.has(con)) ||
          legacy
        ) {
          plan.push(`ALTER TABLE ${q(table)} DROP CONSTRAINT ${q(con)}`);
          checks.delete(con);
        } else if (wantedChecks.has(con)) {
          const want = wantedChecks.get(con)!;
          // pg_get_constraintdef normalises the text; compare the value lists only.
          const values = (d: string) =>
            [...d.matchAll(/'((?:[^']|'')*)'|(-?\d+(?:\.\d+)?)/g)]
              .map((m) => m[1] ?? m[2])
              .sort()
              .join('|');
          if (values(def) !== values(want)) {
            plan.push(`ALTER TABLE ${q(table)} DROP CONSTRAINT ${q(con)}`);
            checks.delete(con);
          }
        }
      }
      for (const [con, def] of wantedChecks) {
        if (!checks.has(con))
          plan.push(`ALTER TABLE ${q(table)} ADD CONSTRAINT ${q(con)} ${def} NOT VALID`);
      }

      // Indexes: create declared ones, drop EFC-named ones the model no longer declares.
      const wantedIndexes = desiredIndexes();
      for (const idx of indexes) {
        if (
          idx !== `${table}_pkey` &&
          idx.startsWith(`${table}_`) &&
          managedIndexName.test(idx) &&
          !wantedIndexes.has(idx)
        ) {
          plan.push(`DROP INDEX ${q(idx)}`);
        }
      }
      for (const [idx, create] of wantedIndexes) if (!indexes.has(idx)) plan.push(create);

      if (!dryRun) {
        for (const stmt of plan) {
          try {
            await conn.query(stmt);
          } catch (err) {
            throw new Error(
              `[EFC] ${name}: syncing table "${table}" failed on: ${stmt}\n  ${(err as Error).message}`,
            );
          }
        }
      }
      await conn.query(dryRun ? 'ROLLBACK' : 'COMMIT');
      return plan;
    } catch (err) {
      await conn.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      conn.release();
    }
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  type Rec = T & { id: string };

  return {
    find: (filter, opts) => guard(async () => (await runFind(filter as AnyRecord, opts)) as Rec[]),

    findById: (id, opts?: ModelQueryOptions) =>
      guard(async () => {
        if (!UUID_RE.test(id)) return null; // malformed id → not found, as on MongoDB
        return ((await runFind({ id }, { ...opts, limit: 1 }))[0] as Rec | undefined) ?? null;
      }),

    findOne: (filter, opts) =>
      guard(
        async () =>
          ((await runFind(filter as AnyRecord, { ...opts, limit: 1 }))[0] as Rec | undefined) ??
          null,
      ),

    create: (data) =>
      guard(async () => {
        const { t } = await ready();
        const row = await prepareInsert(data as AnyRecord);
        const [inserted] = await client().insert(t).values(row).returning();
        return fromRow(inserted) as Rec;
      }),

    createMany: (data) =>
      guard(async () => {
        if (data.length === 0) return [];
        const { t } = await ready();
        const rows = await Promise.all(data.map((d) => prepareInsert(d as AnyRecord)));
        return ((await client().insert(t).values(rows).returning()) as AnyRecord[]).map(
          fromRow,
        ) as Rec[];
      }),

    update: (id, data) =>
      guard(async () => {
        if (!UUID_RE.test(id)) return null;
        const { t, sql } = await ready();
        const set = await buildSet(data as AnyRecord);
        const [row] = await client()
          .update(t)
          .set(set)
          .where(sql`${t.id} = ${id}`)
          .returning();
        return row ? (fromRow(row) as Rec) : null;
      }),

    updateMany: (filter, data) =>
      guard(async () => {
        const { t, sql } = await ready();
        const set = await buildSet(data as AnyRecord);
        let query = client().update(t).set(set);
        const w = where(sql, t, filter as AnyRecord);
        if (w) query = query.where(w);
        return ((await query.returning({ id: t.id })) as unknown[]).length;
      }),

    delete: (id) =>
      guard(async () => {
        if (!UUID_RE.test(id)) return;
        const { t, sql } = await ready();
        await client()
          .delete(t)
          .where(sql`${t.id} = ${id}`);
      }),

    deleteMany: (filter) =>
      guard(async () => {
        const { t, sql } = await ready();
        let query = client().delete(t);
        const w = where(sql, t, filter as AnyRecord);
        if (w) query = query.where(w);
        return ((await query.returning({ id: t.id })) as unknown[]).length;
      }),

    count: (filter) =>
      guard(async () => {
        const { t, sql } = await ready();
        let query = client()
          .select({ n: sql`count(*)::int` })
          .from(t);
        const w = where(sql, t, filter as AnyRecord);
        if (w) query = query.where(w);
        const [row] = (await query) as { n: number }[];
        return row?.n ?? 0;
      }),

    aggregate() {
      return Promise.reject(
        new Error(
          '[EFC] aggregate() is MongoDB-only — on PostgreSQL use db.query() or Drizzle via Model.raw()',
        ),
      );
    },

    raw: async () => (await compile()).t,

    sync: (opts?: { dryRun?: boolean }) => reconcile(opts?.dryRun ?? false),

    async drop() {
      const { sql } = await compile();
      await client().execute(sql.raw(`DROP TABLE IF EXISTS ${q(table)}`));
    },
  };
}
