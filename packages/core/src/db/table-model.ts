/* eslint-disable @typescript-eslint/no-explicit-any -- drizzle is an optional peer, loaded dynamically */
// defineTable: the PostgreSQL-native model API, in Prisma's vocabulary —
// findMany({ where, orderBy, take, skip, cursor, select, distinct }), findUnique, upsert
// (INSERT … ON CONFLICT), groupBy, aggregate. Every query is one parameterised statement,
// compiled with Drizzle's `sql` against the shared pgTable (pg-table.ts).
import type { TableOptions, TableSchema } from '../types.js';
import type { TableModel } from '../table-types.js';
import { HttpError } from '../errors.js';
import { ModelValidationError, normalizeSchema, type FieldIssue } from './schema.js';
import { getDbEngine, registerModel } from './engine.js';
import { pgTable, q, type ColumnSpec, type PgTable } from './pg-table.js';
import { traceOps } from './query-log.js';

type AnyRecord = Record<string, any>;
type Sql = any;

const AGGREGATES = ['_count', '_sum', '_avg', '_min', '_max'] as const;
type Aggregate = (typeof AGGREGATES)[number];
const NUMERIC_KINDS = new Set(['double', 'integer', 'bigint', 'numeric']);

const isPlainObject = (v: unknown): v is AnyRecord =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  !(v instanceof Date) &&
  !(v instanceof RegExp) &&
  typeof v !== 'bigint';

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** The runtime behind a `defineTable` model, compiled on first use. */
class TableRuntime {
  readonly tbl: PgTable;
  private readonly uniqueSets: string[][];

  constructor(
    readonly name: string,
    schema: TableSchema,
    readonly options: TableOptions,
  ) {
    const tree = normalizeSchema(schema, 'table', name);
    this.tbl = pgTable(name, tree, options, { native: true, api: 'defineTable' });
    this.uniqueSets = [['id']];
    for (const spec of this.tbl.columns.values()) {
      if (spec.node?.def.unique) this.uniqueSets.push([spec.field]);
    }
    for (const idx of options.indexes ?? []) {
      if (idx.unique) this.uniqueSets.push(Object.keys(idx.fields));
    }
  }

  private fail(path: string, message: string): never {
    throw new ModelValidationError(this.name, [{ path, message }]);
  }

  private spec(field: string): ColumnSpec | undefined {
    return this.tbl.columns.get(field);
  }

  private col(sql: Sql, field: string, alias?: string): Sql {
    const spec = this.spec(field)!;
    return sql.raw(alias ? `${alias}.${q(spec.column)}` : q(spec.column));
  }

  /** A value for `field`, encoded the way its Drizzle column does it. */
  private val(sql: Sql, t: any, field: string, value: unknown): Sql {
    return sql`${sql.param(this.tbl.toDb(field, value), t[field])}`;
  }

  /** One array element / scalar compared against an array column's items. */
  private itemVal(sql: Sql, field: string, value: unknown): Sql {
    const spec = this.spec(field)!;
    const [v] = (this.tbl.toDb(field, [value]) as unknown[]) ?? [value];
    return sql`${sql.param(spec.item === 'bigint' ? String(v) : v)}`;
  }

  private fromRaw(t: any, row: AnyRecord): AnyRecord {
    const keyed: AnyRecord = {};
    for (const spec of this.tbl.columns.values()) {
      if (!(spec.column in row)) continue;
      const v = row[spec.column];
      keyed[spec.field] = v == null ? v : t[spec.field].mapFromDriverValue(v);
    }
    return this.tbl.fromRow(keyed);
  }

  // ── where ──────────────────────────────────────────────────────────────────

  where(sql: Sql, t: any, where: AnyRecord | undefined): Sql | undefined {
    if (!where) return undefined;
    const parts: Sql[] = [];
    for (const [key, value] of Object.entries(where)) {
      if (value === undefined) continue;
      if (key === 'AND' || key === 'OR' || key === 'NOT') {
        const list = (Array.isArray(value) ? value : [value]) as AnyRecord[];
        const subs = list.map((w) => this.where(sql, t, w) ?? sql`true`);
        if (key === 'AND')
          parts.push(subs.length ? sql`(${sql.join(subs, sql` and `)})` : sql`true`);
        else if (key === 'OR')
          parts.push(subs.length ? sql`(${sql.join(subs, sql` or `)})` : sql`false`);
        else parts.push(subs.length ? sql`not (${sql.join(subs, sql` or `)})` : sql`true`);
        continue;
      }
      const spec = this.spec(key);
      if (!spec) {
        // Undeclared: absent from every row, as on defineModel.
        const isNull = value === null || (isPlainObject(value) && value['equals'] === null);
        parts.push(isNull ? sql`true` : sql`false`);
        continue;
      }
      parts.push(this.fieldFilter(sql, t, spec, value));
    }
    if (parts.length === 0) return undefined;
    return parts.length === 1 ? parts[0] : sql`(${sql.join(parts, sql` and `)})`;
  }

  private fieldFilter(sql: Sql, t: any, spec: ColumnSpec, filter: unknown): Sql {
    const c = this.col(sql, spec.field);
    if (filter === null) return sql`${c} is null`;
    if (spec.kind === 'jsonb') return this.jsonFilter(sql, t, spec, filter);
    if (spec.kind === 'array') return this.listFilter(sql, t, spec, filter);
    if (!isPlainObject(filter)) return sql`${c} = ${this.val(sql, t, spec.field, filter)}`;

    const insensitive = filter['mode'] === 'insensitive';
    const text = spec.kind === 'enum' || insensitive ? sql`${c}::text` : c;
    const parts: Sql[] = [];
    for (const [op, v] of Object.entries(filter)) {
      if (v === undefined || op === 'mode') continue;
      const val = () => this.val(sql, t, spec.field, v);
      const eq = (x: unknown) =>
        insensitive && typeof x === 'string'
          ? sql`lower(${text}) = lower(${sql.param(x)})`
          : sql`${c} = ${this.val(sql, t, spec.field, x)}`;
      switch (op) {
        case 'equals':
          parts.push(v === null ? sql`${c} is null` : eq(v));
          break;
        case 'not':
          parts.push(
            v === null
              ? sql`${c} is not null`
              : isPlainObject(v)
                ? sql`not (${this.fieldFilter(sql, t, spec, { ...v, ...(insensitive && { mode: 'insensitive' }) })})`
                : sql`not (${eq(v)})`,
          );
          break;
        case 'in':
        case 'notIn': {
          const list = v as unknown[];
          if (list.length === 0) {
            parts.push(op === 'in' ? sql`false` : sql`true`);
            break;
          }
          const items = sql.join(
            list.map((x) => this.val(sql, t, spec.field, x)),
            sql`, `,
          );
          parts.push(op === 'in' ? sql`${c} in (${items})` : sql`${c} not in (${items})`);
          break;
        }
        case 'lt':
          parts.push(sql`${c} < ${val()}`);
          break;
        case 'lte':
          parts.push(sql`${c} <= ${val()}`);
          break;
        case 'gt':
          parts.push(sql`${c} > ${val()}`);
          break;
        case 'gte':
          parts.push(sql`${c} >= ${val()}`);
          break;
        case 'contains':
        case 'startsWith':
        case 'endsWith': {
          const s = likeEscape(String(v));
          const pattern = op === 'contains' ? `%${s}%` : op === 'startsWith' ? `${s}%` : `%${s}`;
          parts.push(
            insensitive
              ? sql`${text} ilike ${sql.param(pattern)}`
              : sql`${text} like ${sql.param(pattern)}`,
          );
          break;
        }
        default:
          this.fail(spec.field, `unknown filter "${op}"`);
      }
    }
    return parts.length === 0
      ? sql`true`
      : parts.length === 1
        ? parts[0]
        : sql`(${sql.join(parts, sql` and `)})`;
  }

  /** Scalar lists (native arrays): has, hasEvery, hasSome, isEmpty, equals. */
  private listFilter(sql: Sql, t: any, spec: ColumnSpec, filter: unknown): Sql {
    const c = this.col(sql, spec.field);
    if (!isPlainObject(filter)) return sql`${c} = ${this.val(sql, t, spec.field, filter)}`;
    const parts: Sql[] = [];
    for (const [op, v] of Object.entries(filter)) {
      if (v === undefined) continue;
      switch (op) {
        case 'equals':
          parts.push(
            v === null ? sql`${c} is null` : sql`${c} = ${this.val(sql, t, spec.field, v)}`,
          );
          break;
        case 'has':
          parts.push(
            v === null ? sql`false` : sql`${this.itemVal(sql, spec.field, v)} = any(${c})`,
          );
          break;
        case 'hasEvery':
          parts.push(sql`${c} @> ${this.val(sql, t, spec.field, v)}`);
          break;
        case 'hasSome':
          parts.push(sql`${c} && ${this.val(sql, t, spec.field, v)}`);
          break;
        case 'isEmpty':
          parts.push(v ? sql`cardinality(${c}) = 0` : sql`cardinality(${c}) > 0`);
          break;
        default:
          this.fail(spec.field, `unknown list filter "${op}"`);
      }
    }
    return parts.length === 1 ? parts[0] : sql`(${sql.join(parts, sql` and `)})`;
  }

  /** jsonb fields (embedded objects / arrays of objects / json): Prisma's JSON filters. */
  private jsonFilter(sql: Sql, t: any, spec: ColumnSpec, filter: unknown): Sql {
    const c = this.col(sql, spec.field);
    const json = (v: unknown) => sql`${sql.param(JSON.stringify(v))}::jsonb`;
    if (!isPlainObject(filter) || !Object.keys(filter).some((k) => JSON_OPS.has(k))) {
      return sql`${c} = ${json(filter)}`;
    }
    const path = filter['path'] as string[] | string | undefined;
    const segs = path === undefined ? [] : Array.isArray(path) ? path : String(path).split('.');
    const target = segs.length ? sql`(${c} #> ${sql.param(`{${segs.join(',')}}`)})` : c;
    const textTarget = segs.length
      ? sql`(${c} #>> ${sql.param(`{${segs.join(',')}}`)})`
      : sql`(${c} #>> '{}')`;
    const parts: Sql[] = [];
    for (const [op, v] of Object.entries(filter)) {
      if (v === undefined || op === 'path' || op === 'mode') continue;
      switch (op) {
        case 'equals':
          parts.push(v === null ? sql`${target} is null` : sql`${target} = ${json(v)}`);
          break;
        case 'not':
          parts.push(
            v === null ? sql`${target} is not null` : sql`${target} is distinct from ${json(v)}`,
          );
          break;
        case 'string_contains':
        case 'string_starts_with':
        case 'string_ends_with': {
          const s = likeEscape(String(v));
          const p =
            op === 'string_contains' ? `%${s}%` : op === 'string_starts_with' ? `${s}%` : `%${s}`;
          parts.push(
            filter['mode'] === 'insensitive'
              ? sql`${textTarget} ilike ${sql.param(p)}`
              : sql`${textTarget} like ${sql.param(p)}`,
          );
          break;
        }
        case 'array_contains':
          parts.push(sql`${target} @> ${json(Array.isArray(v) ? v : [v])}`);
          break;
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte': {
          const opSql = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[op];
          parts.push(
            typeof v === 'number'
              ? sql`(${textTarget})::double precision ${sql.raw(opSql)} ${sql.param(v)}`
              : sql`${textTarget} ${sql.raw(opSql)} ${sql.param(v instanceof Date ? v.toISOString() : String(v))}`,
          );
          break;
        }
        default:
          this.fail(spec.field, `unknown JSON filter "${op}"`);
      }
    }
    return parts.length === 1 ? parts[0] : sql`(${sql.join(parts, sql` and `)})`;
  }

  // ── ordering, projection, pagination ───────────────────────────────────────

  private orderList(
    orderBy: unknown,
  ): { field: string; desc: boolean; nulls?: 'first' | 'last' }[] {
    const list = orderBy === undefined ? [] : Array.isArray(orderBy) ? orderBy : [orderBy];
    const out: { field: string; desc: boolean; nulls?: 'first' | 'last' }[] = [];
    for (const entry of list as AnyRecord[]) {
      for (const [field, dir] of Object.entries(entry)) {
        if (dir === undefined || !this.spec(field)) continue; // undeclared: ignored
        if (isPlainObject(dir))
          out.push({ field, desc: dir['sort'] === 'desc', nulls: dir['nulls'] });
        else out.push({ field, desc: dir === 'desc' });
      }
    }
    return out;
  }

  private orderSql(
    sql: Sql,
    list: { field: string; desc: boolean; nulls?: 'first' | 'last' }[],
  ): Sql {
    return sql.join(
      list.map(
        (o) =>
          sql`${this.col(sql, o.field)} ${sql.raw(o.desc ? 'desc' : 'asc')}${o.nulls ? sql.raw(` nulls ${o.nulls}`) : sql``}`,
      ),
      sql`, `,
    );
  }

  /** The fields a result keeps, from `select` / `omit`. */
  private projection(args: AnyRecord): string[] {
    const all = [...this.tbl.columns.keys()];
    if (args['select'] && args['omit']) this.fail('select', 'use either select or omit, not both');
    if (args['select']) {
      const keep = Object.entries(args['select'] as AnyRecord)
        .filter(([f, on]) => on && this.spec(f))
        .map(([f]) => f);
      return keep;
    }
    if (args['omit']) {
      const drop = new Set(
        Object.entries(args['omit'] as AnyRecord)
          .filter(([, on]) => on)
          .map(([f]) => f),
      );
      return all.filter((f) => !drop.has(f));
    }
    return all;
  }

  private project(record: AnyRecord, fields: string[]): AnyRecord {
    const out: AnyRecord = {};
    for (const f of fields) if (record[f] !== undefined) out[f] = record[f];
    return out;
  }

  /** Checks `where` names a unique key (id, a unique field, or a compound unique index). */
  uniqueKey(where: AnyRecord | undefined, op: string): string[] {
    const plain = (f: string) =>
      where?.[f] !== undefined && where[f] !== null && !isPlainObject(where[f]);
    const key = this.uniqueSets.find((set) => set.every(plain));
    if (!key) {
      this.fail(
        'where',
        `${op} needs a unique field in where: ${this.uniqueSets.map((s) => s.join(' + ')).join(', ')}`,
      );
    }
    return key;
  }

  /** WHERE for findMany-style reads: filter, plus the cursor's keyset condition. */
  private readWhere(
    sql: Sql,
    t: any,
    args: AnyRecord,
    order: ReturnType<TableRuntime['orderList']>,
  ): Sql {
    const parts: Sql[] = [];
    const w = this.where(sql, t, args['where']);
    if (w) parts.push(w);
    if (args['cursor']) {
      this.uniqueKey(args['cursor'], 'cursor');
      const cw = this.where(sql, t, args['cursor'])!;
      const at = (field: string) =>
        sql`(select ${this.col(sql, field)} from ${sql.raw(q(this.tbl.table))} where ${cw})`;
      // Rows at or after the cursor in `order`: a keyset comparison expanded per column so
      // mixed directions work, NULL-aware (PostgreSQL puts NULLs last ascending, first
      // descending, unless `nulls` says otherwise). The cursor row itself is included
      // (skip: 1 drops it).
      const ors: Sql[] = [];
      const same = (o: { field: string }) =>
        sql`${this.col(sql, o.field)} is not distinct from ${at(o.field)}`;
      for (let i = 0; i < order.length; i++) {
        const o = order[i]!;
        const c = this.col(sql, o.field);
        const v = at(o.field);
        const nullsFirst = o.nulls ? o.nulls === 'first' : o.desc;
        const after = sql`((${v} is null and ${nullsFirst ? sql`${c} is not null` : sql`false`}) or (${v} is not null and (${c} ${sql.raw(o.desc ? '<' : '>')} ${v}${nullsFirst ? sql`` : sql` or ${c} is null`})))`;
        const eqs = order.slice(0, i).map(same);
        ors.push(eqs.length ? sql`(${sql.join([...eqs, after], sql` and `)})` : after);
      }
      ors.push(sql`(${sql.join(order.map(same), sql` and `)})`);
      parts.push(sql`exists (select 1 from ${sql.raw(q(this.tbl.table))} where ${cw})`);
      parts.push(sql`(${sql.join(ors, sql` or `)})`);
    }
    return parts.length ? sql.join(parts, sql` and `) : sql`true`;
  }

  /** SELECT for a findMany-style read, and whether the rows come back reversed. */
  private readQuery(
    sql: Sql,
    t: any,
    args: AnyRecord,
    columnsSql: Sql,
  ): { query: Sql; reversed: boolean } {
    const take = args['take'] as number | undefined;
    const reversed = take !== undefined && take < 0;
    let order = this.orderList(args['orderBy']);
    // Pages need a total order, so every page agrees on where ties go: break them by id.
    const paged = args['cursor'] || take !== undefined || args['skip'];
    if (paged && !order.some((o) => o.field === 'id')) {
      order = [...order, { field: 'id', desc: false }];
    }
    if (reversed) {
      order = order.map((o) => ({
        ...o,
        desc: !o.desc,
        ...(o.nulls && { nulls: o.nulls === 'first' ? ('last' as const) : ('first' as const) }),
      }));
    }
    const limit = take === undefined ? sql`` : sql` limit ${sql.param(Math.abs(take))}`;
    const offset = args['skip'] ? sql` offset ${sql.param(args['skip'])}` : sql``;
    const orderBy = order.length ? sql` order by ${this.orderSql(sql, order)}` : sql``;
    const where = this.readWhere(sql, t, args, order);
    const from = sql.raw(q(this.tbl.table));

    const distinct = (args['distinct'] as string[] | undefined)?.filter((f) => this.spec(f));
    if (distinct?.length) {
      const dcols = sql.join(
        distinct.map((f) => this.col(sql, f)),
        sql`, `,
      );
      const inner = sql`select distinct on (${dcols}) * from ${from} where ${where} order by ${dcols}${order.length ? sql`, ${this.orderSql(sql, order)}` : sql``}`;
      return {
        query: sql`select ${columnsSql} from (${inner}) as efc_distinct${orderBy}${limit}${offset}`,
        reversed,
      };
    }
    return {
      query: sql`select ${columnsSql} from ${from} where ${where}${orderBy}${limit}${offset}`,
      reversed,
    };
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  async findMany(args: AnyRecord = {}): Promise<AnyRecord[]> {
    const { t, sql } = await this.tbl.ready();
    return this.tbl.guard(async () => {
      const fields = this.projection(args);
      const cols = sql.join(
        [...new Set(['id', ...fields])].map((f) => this.col(sql, f)),
        sql`, `,
      );
      const { query, reversed } = this.readQuery(sql, t, args, cols);
      const rows = ((await this.tbl.client().execute(query)).rows as AnyRecord[]).map((r) =>
        this.project(this.fromRaw(t, r), fields),
      );
      return reversed ? rows.reverse() : rows;
    });
  }

  async findFirst(args: AnyRecord = {}): Promise<AnyRecord | null> {
    const take = args['take'] as number | undefined;
    const rows = await this.findMany({ ...args, take: take !== undefined && take < 0 ? -1 : 1 });
    return rows[0] ?? null;
  }

  async findUnique(args: AnyRecord): Promise<AnyRecord | null> {
    this.uniqueKey(args['where'], 'findUnique');
    return this.findFirst({ where: args['where'], select: args['select'], omit: args['omit'] });
  }

  async orThrow<R>(p: Promise<R | null>): Promise<R> {
    const r = await p;
    if (r === null) throw new HttpError(404, `${this.name} not found`);
    return r;
  }

  async count(args: AnyRecord = {}): Promise<number | AnyRecord> {
    const { t, sql } = await this.tbl.ready();
    return this.tbl.guard(async () => {
      const select = args['select'] as AnyRecord | undefined;
      const counted = select
        ? Object.entries(select).filter(([f, on]) => on && (f === '_all' || this.spec(f)))
        : [['_all', true]];
      const exprs = sql.join(
        counted.map(([f]) =>
          f === '_all'
            ? sql`count(*)::int as ${sql.raw(q('_all'))}`
            : sql`count(${this.col(sql, f as string, 'efc_rows')})::int as ${sql.raw(q(f as string))}`,
        ),
        sql`, `,
      );
      const { query } = this.readQuery(
        sql,
        t,
        { ...args, select: undefined, distinct: args['distinct'] },
        sql`*`,
      );
      const [row] = (
        await this.tbl.client().execute(sql`select ${exprs} from (${query}) as efc_rows`)
      ).rows as AnyRecord[];
      return select ? (row as AnyRecord) : (row!['_all'] as number);
    });
  }

  // ── aggregates ─────────────────────────────────────────────────────────────

  private aggregateSpec(args: AnyRecord): { agg: Aggregate; field: string; alias: string }[] {
    const out: { agg: Aggregate; field: string; alias: string }[] = [];
    for (const agg of AGGREGATES) {
      const v = args[agg];
      if (!v) continue;
      if (v === true) {
        if (agg !== '_count') this.fail(agg, `${agg} needs fields, e.g. { total: true }`);
        out.push({ agg, field: '_all', alias: `${agg}._all` });
        continue;
      }
      for (const [field, on] of Object.entries(v as AnyRecord)) {
        if (!on) continue;
        if (field === '_all' && agg === '_count') {
          out.push({ agg, field, alias: `${agg}._all` });
          continue;
        }
        const spec = this.spec(field);
        if (!spec) this.fail(`${agg}.${field}`, 'unknown field');
        if ((agg === '_sum' || agg === '_avg') && !NUMERIC_KINDS.has(spec.kind)) {
          this.fail(`${agg}.${field}`, `${agg} needs a numeric field`);
        }
        out.push({ agg, field, alias: `${agg}.${field}` });
      }
    }
    return out;
  }

  private aggregateExpr(sql: Sql, agg: Aggregate, field: string): Sql {
    if (agg === '_count')
      return field === '_all' ? sql`count(*)` : sql`count(${this.col(sql, field)})`;
    const fn = { _sum: 'sum', _avg: 'avg', _min: 'min', _max: 'max' }[agg];
    return sql`${sql.raw(fn)}(${this.col(sql, field)})`;
  }

  /** Raw aggregate value → the type Prisma returns for it. */
  private aggregateValue(t: any, agg: Aggregate, field: string, v: unknown): unknown {
    if (agg === '_count') return Number(v);
    if (v == null) return null;
    const spec = this.spec(field)!;
    if (agg === '_min' || agg === '_max') return t[field].mapFromDriverValue(v);
    if (spec.kind === 'numeric') return String(v);
    if (agg === '_sum' && spec.kind === 'bigint') return BigInt(String(v).split('.')[0]!);
    return Number(v);
  }

  private aggregateRow(
    t: any,
    specs: ReturnType<TableRuntime['aggregateSpec']>,
    row: AnyRecord,
    args: AnyRecord,
  ): AnyRecord {
    const out: AnyRecord = {};
    for (const { agg, field, alias } of specs) {
      const value = this.aggregateValue(t, agg, field, row[alias]);
      // `_count: true` → a number; `_count: { _all: true, … }` → an object, as in Prisma.
      if (agg === '_count' && args['_count'] === true) out[agg] = value;
      else (out[agg] ??= {})[field] = value;
    }
    return out;
  }

  async aggregate(args: AnyRecord = {}): Promise<AnyRecord> {
    const { t, sql } = await this.tbl.ready();
    return this.tbl.guard(async () => {
      const specs = this.aggregateSpec(args);
      if (specs.length === 0) return {};
      const exprs = sql.join(
        specs.map((s) => sql`${this.aggregateExpr(sql, s.agg, s.field)} as ${sql.raw(q(s.alias))}`),
        sql`, `,
      );
      const { query } = this.readQuery(sql, t, { ...args, select: undefined }, sql`*`);
      const [row] = (
        await this.tbl.client().execute(sql`select ${exprs} from (${query}) as efc_rows`)
      ).rows as AnyRecord[];
      return this.aggregateRow(t, specs, row!, args);
    });
  }

  private havingSql(sql: Sql, t: any, having: AnyRecord | undefined): Sql | undefined {
    if (!having) return undefined;
    const parts: Sql[] = [];
    for (const [key, value] of Object.entries(having)) {
      if (value === undefined) continue;
      if (key === 'AND' || key === 'OR' || key === 'NOT') {
        const list = (Array.isArray(value) ? value : [value]) as AnyRecord[];
        const subs = list.map((h) => this.havingSql(sql, t, h) ?? sql`true`);
        const joined = sql.join(
          subs,
          key === 'OR' ? sql` or ` : key === 'NOT' ? sql` or ` : sql` and `,
        );
        parts.push(key === 'NOT' ? sql`not (${joined})` : sql`(${joined})`);
        continue;
      }
      const spec = this.spec(key);
      if (!spec) this.fail(`having.${key}`, 'unknown field');
      const filter = value as AnyRecord;
      const aggKeys = isPlainObject(filter)
        ? Object.keys(filter).filter((k) => (AGGREGATES as readonly string[]).includes(k))
        : [];
      if (aggKeys.length === 0) {
        parts.push(this.fieldFilter(sql, t, spec, filter));
        continue;
      }
      for (const agg of aggKeys as Aggregate[]) {
        const expr = this.aggregateExpr(sql, agg, key);
        for (const [op, v] of Object.entries(filter[agg] as AnyRecord)) {
          const opSql = { equals: '=', not: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op];
          if (!opSql) this.fail(`having.${key}.${agg}`, `unknown filter "${op}"`);
          parts.push(
            sql`${expr} ${sql.raw(opSql)} ${sql.param(typeof v === 'bigint' ? String(v) : v instanceof Date ? v : v)}`,
          );
        }
      }
    }
    return parts.length ? sql.join(parts, sql` and `) : undefined;
  }

  async groupBy(args: AnyRecord): Promise<AnyRecord[]> {
    const { t, sql } = await this.tbl.ready();
    return this.tbl.guard(async () => {
      const by = (Array.isArray(args['by']) ? args['by'] : [args['by']]) as string[];
      if (by.length === 0) this.fail('by', 'groupBy needs at least one field');
      for (const f of by) if (!this.spec(f)) this.fail(`by.${f}`, 'unknown field');
      const specs = this.aggregateSpec(args);
      const select = sql.join(
        [
          ...by.map((f) => this.col(sql, f)),
          ...specs.map(
            (s) => sql`${this.aggregateExpr(sql, s.agg, s.field)} as ${sql.raw(q(s.alias))}`,
          ),
        ],
        sql`, `,
      );
      const where = this.where(sql, t, args['where']);
      const having = this.havingSql(sql, t, args['having']);
      const orders: Sql[] = [];
      for (const entry of (Array.isArray(args['orderBy'])
        ? args['orderBy']
        : args['orderBy']
          ? [args['orderBy']]
          : []) as AnyRecord[]) {
        for (const [key, dir] of Object.entries(entry)) {
          if ((AGGREGATES as readonly string[]).includes(key)) {
            for (const [field, d] of Object.entries(dir as AnyRecord)) {
              orders.push(
                sql`${this.aggregateExpr(sql, key as Aggregate, field)} ${sql.raw(d === 'desc' ? 'desc' : 'asc')}`,
              );
            }
          } else if (this.spec(key)) {
            if (!by.includes(key))
              this.fail(`orderBy.${key}`, 'groupBy can only order by grouped fields or aggregates');
            const d = isPlainObject(dir) ? dir['sort'] : dir;
            orders.push(sql`${this.col(sql, key)} ${sql.raw(d === 'desc' ? 'desc' : 'asc')}`);
          }
        }
      }
      const query = sql`select ${select} from ${sql.raw(q(this.tbl.table))}${where ? sql` where ${where}` : sql``} group by ${sql.join(
        by.map((f) => this.col(sql, f)),
        sql`, `,
      )}${having ? sql` having ${having}` : sql``}${orders.length ? sql` order by ${sql.join(orders, sql`, `)}` : sql``}${
        args['take'] !== undefined ? sql` limit ${sql.param(args['take'])}` : sql``
      }${args['skip'] ? sql` offset ${sql.param(args['skip'])}` : sql``}`;
      const rows = (await this.tbl.client().execute(query)).rows as AnyRecord[];
      return rows.map((row) => {
        const keyed: AnyRecord = {};
        for (const f of by) keyed[f] = row[this.spec(f)!.column];
        const out = this.project(
          this.fromRaw(t, Object.fromEntries(by.map((f) => [this.spec(f)!.column, keyed[f]]))),
          by,
        );
        for (const f of by) if (!(f in out)) out[f] = null;
        return { ...out, ...this.aggregateRow(t, specs, row, args) };
      });
    });
  }

  // ── writes ─────────────────────────────────────────────────────────────────

  /** Prisma update data → SET expressions, validated. */
  private async setList(sql: Sql, t: any, data: AnyRecord, alias?: string): Promise<Sql[]> {
    const sets: Sql[] = [];
    const plain: AnyRecord = {};
    const issues: FieldIssue[] = [];
    const ref = (f: string) => this.col(sql, f, alias);
    for (const [field, value] of Object.entries(data)) {
      if (value === undefined) continue;
      const spec = this.spec(field);
      if (
        !spec ||
        field === 'id' ||
        field === this.tbl.ts.createdAt ||
        field === this.tbl.ts.updatedAt
      ) {
        continue; // undeclared / managed: ignored, as on writes everywhere
      }
      const ops = isPlainObject(value) && spec.kind !== 'jsonb' ? value : undefined;
      if (!ops) {
        plain[field] = value;
        continue;
      }
      for (const [op, v] of Object.entries(ops)) {
        if (v === undefined) continue;
        if (op === 'set') {
          plain[field] = v;
        } else if (
          op === 'increment' ||
          op === 'decrement' ||
          op === 'multiply' ||
          op === 'divide'
        ) {
          if (!NUMERIC_KINDS.has(spec.kind)) {
            issues.push({ path: field, message: `${op} only applies to number fields` });
            continue;
          }
          const okOperand =
            (typeof v === 'number' && Number.isFinite(v)) ||
            typeof v === 'bigint' ||
            (spec.kind === 'numeric' && typeof v === 'string');
          if (!okOperand) {
            issues.push({ path: field, message: `${op} needs a number` });
            continue;
          }
          const sym = { increment: '+', decrement: '-', multiply: '*', divide: '/' }[op];
          sets.push(
            sql`${this.col(sql, field)} = ${ref(field)} ${sql.raw(sym)} ${this.val(sql, t, field, v)}`,
          );
        } else if (op === 'push' && spec.kind === 'array') {
          const items = Array.isArray(v) ? v : [v];
          sets.push(
            sql`${this.col(sql, field)} = coalesce(${ref(field)}, ${sql.raw(`'{}'::${spec.ddl}`)}) || ${this.val(sql, t, field, items)}::${sql.raw(spec.ddl)}`,
          );
        } else {
          issues.push({ path: field, message: `unknown update operation "${op}"` });
        }
      }
    }
    if (issues.length) throw new ModelValidationError(this.name, issues);
    await this.tbl.validate(plain, true);
    for (const [field, v] of Object.entries(plain)) {
      sets.push(
        sql`${this.col(sql, field)} = ${v === null ? sql`null` : this.val(sql, t, field, v)}`,
      );
    }
    if (this.tbl.ts.updatedAt && sets.length) {
      sets.push(
        sql`${this.col(sql, this.tbl.ts.updatedAt)} = ${this.val(sql, t, this.tbl.ts.updatedAt, new Date())}`,
      );
    }
    return sets;
  }

  private insertSql(sql: Sql, t: any, rows: AnyRecord[]): { head: Sql; values: Sql } {
    const fields = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const head = sql`insert into ${sql.raw(q(this.tbl.table))} (${sql.join(
      fields.map((f) => this.col(sql, f)),
      sql`, `,
    )})`;
    const values = sql.join(
      rows.map(
        (r) =>
          sql`(${sql.join(
            fields.map((f) => (r[f] === undefined ? sql`default` : sql`${sql.param(r[f], t[f])}`)),
            sql`, `,
          )})`,
      ),
      sql`, `,
    );
    return { head, values };
  }

  private async prepare(data: AnyRecord | undefined): Promise<AnyRecord> {
    if (!isPlainObject(data)) this.fail('data', 'must be an object');
    return this.tbl.prepareInsert(data);
  }

  async create(args: AnyRecord): Promise<AnyRecord> {
    const { t, sql } = await this.tbl.ready();
    return this.tbl.guard(async () => {
      const row = await this.prepare(args['data']);
      const { head, values } = this.insertSql(sql, t, [row]);
      const [inserted] = (
        await this.tbl.client().execute(sql`${head} values ${values} returning *`)
      ).rows as AnyRecord[];
      return this.project(this.fromRaw(t, inserted!), this.projection(args));
    });
  }

  async createMany(args: AnyRecord, returning: boolean): Promise<{ count: number } | AnyRecord[]> {
    const { t, sql } = await this.tbl.ready();
    return this.tbl.guard(async () => {
      const data = (Array.isArray(args['data']) ? args['data'] : [args['data']]) as AnyRecord[];
      if (data.length === 0) return returning ? [] : { count: 0 };
      const rows = await Promise.all(data.map((d) => this.prepare(d)));
      const { head, values } = this.insertSql(sql, t, rows);
      const conflict = args['skipDuplicates'] ? sql` on conflict do nothing` : sql``;
      const result = await this.tbl
        .client()
        .execute(sql`${head} values ${values}${conflict}${returning ? sql` returning *` : sql``}`);
      if (!returning) return { count: result.rowCount ?? 0 };
      const fields = this.projection(args);
      return (result.rows as AnyRecord[]).map((r) => this.project(this.fromRaw(t, r), fields));
    });
  }

  async update(args: AnyRecord): Promise<AnyRecord> {
    this.uniqueKey(args['where'], 'update');
    const { t, sql } = await this.tbl.ready();
    return this.tbl.guard(async () => {
      const sets = await this.setList(sql, t, args['data'] ?? {});
      const where = this.where(sql, t, args['where'])!;
      const query = sets.length
        ? sql`update ${sql.raw(q(this.tbl.table))} set ${sql.join(sets, sql`, `)} where ${where} returning *`
        : sql`select * from ${sql.raw(q(this.tbl.table))} where ${where} limit 1`;
      const [row] = (await this.tbl.client().execute(query)).rows as AnyRecord[];
      if (!row) throw new HttpError(404, `${this.name} not found`);
      return this.project(this.fromRaw(t, row), this.projection(args));
    });
  }

  async updateMany(args: AnyRecord, returning: boolean): Promise<{ count: number } | AnyRecord[]> {
    const { t, sql } = await this.tbl.ready();
    return this.tbl.guard(async () => {
      const sets = await this.setList(sql, t, args['data'] ?? {});
      if (sets.length === 0) {
        if (!returning) return { count: 0 };
        return this.findMany({ where: args['where'], select: args['select'], omit: args['omit'] });
      }
      const where = this.where(sql, t, args['where']) ?? sql`true`;
      const result = await this.tbl
        .client()
        .execute(
          sql`update ${sql.raw(q(this.tbl.table))} set ${sql.join(sets, sql`, `)} where ${where}${returning ? sql` returning *` : sql``}`,
        );
      if (!returning) return { count: result.rowCount ?? 0 };
      const fields = this.projection(args);
      return (result.rows as AnyRecord[]).map((r) => this.project(this.fromRaw(t, r), fields));
    });
  }

  async upsert(args: AnyRecord): Promise<AnyRecord> {
    const key = this.uniqueKey(args['where'], 'upsert');
    const { t, sql } = await this.tbl.ready();
    return this.tbl.guard(async () => {
      const row = await this.prepare(args['create']);
      for (const f of key) {
        if (row[f] === undefined) row[f] = this.tbl.toDb(f, args['where'][f]);
      }
      const { head, values } = this.insertSql(sql, t, [row]);
      let sets = await this.setList(sql, t, args['update'] ?? {}, q(this.tbl.table));
      // Nothing to update: a no-op assignment still makes RETURNING yield the existing row.
      if (sets.length === 0)
        sets = [sql`${this.col(sql, key[0]!)} = excluded.${this.col(sql, key[0]!)}`];
      const target = sql.join(
        key.map((f) => this.col(sql, f)),
        sql`, `,
      );
      const extra = Object.keys(args['where']).filter((f) => !key.includes(f));
      const cond = extra.length
        ? sql` where ${this.where(sql, t, Object.fromEntries(extra.map((f) => [f, args['where'][f]])))}`
        : sql``;
      const [out] = (
        await this.tbl
          .client()
          .execute(
            sql`${head} values ${values} on conflict (${target}) do update set ${sql.join(sets, sql`, `)}${cond} returning *`,
          )
      ).rows as AnyRecord[];
      if (!out) throw new HttpError(404, `${this.name} not found`);
      return this.project(this.fromRaw(t, out), this.projection(args));
    });
  }

  async delete(args: AnyRecord): Promise<AnyRecord> {
    this.uniqueKey(args['where'], 'delete');
    const { t, sql } = await this.tbl.ready();
    return this.tbl.guard(async () => {
      const where = this.where(sql, t, args['where'])!;
      const [row] = (
        await this.tbl
          .client()
          .execute(sql`delete from ${sql.raw(q(this.tbl.table))} where ${where} returning *`)
      ).rows as AnyRecord[];
      if (!row) throw new HttpError(404, `${this.name} not found`);
      return this.project(this.fromRaw(t, row), this.projection(args));
    });
  }

  async deleteMany(args: AnyRecord = {}): Promise<{ count: number }> {
    const { t, sql } = await this.tbl.ready();
    return this.tbl.guard(async () => {
      const where = this.where(sql, t, args['where']) ?? sql`true`;
      const result = await this.tbl
        .client()
        .execute(sql`delete from ${sql.raw(q(this.tbl.table))} where ${where}`);
      return { count: result.rowCount ?? 0 };
    });
  }
}

const JSON_OPS = new Set([
  'path',
  'equals',
  'not',
  'string_contains',
  'string_starts_with',
  'string_ends_with',
  'array_contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'mode',
]);

/**
 * A PostgreSQL-native model in Prisma's vocabulary. Types are inferred from the schema;
 * see `TableModel`. Fails at first use, with an `[EFC]` error, on a MongoDB connection.
 */
export function createTable(name: string, schema: TableSchema, options: TableOptions = {}) {
  // Schema errors surface at definition time; the runtime (Drizzle table) on first use.
  normalizeSchema(schema, 'table', name);
  let runtime: TableRuntime | undefined;
  const rt = (): TableRuntime => {
    const engine = getDbEngine();
    if (engine !== 'postgresql') {
      throw new Error(
        `[EFC] ${name} is a PostgreSQL table (defineTable) but the app is connected to MongoDB — check DATABASE_URL / config.database, or use defineModel for a model that runs on both`,
      );
    }
    return (runtime ??= new TableRuntime(name, schema, options));
  };
  const call = <R>(fn: (r: TableRuntime) => Promise<R>): Promise<R> =>
    Promise.resolve().then(() => fn(rt()));

  const model = {
    name,
    findMany: (args?: AnyRecord) => call((r) => r.findMany(args)),
    findFirst: (args?: AnyRecord) => call((r) => r.findFirst(args)),
    findFirstOrThrow: (args?: AnyRecord) => call((r) => r.orThrow(r.findFirst(args))),
    findUnique: (args: AnyRecord) => call((r) => r.findUnique(args)),
    findUniqueOrThrow: (args: AnyRecord) => call((r) => r.orThrow(r.findUnique(args))),
    count: (args?: AnyRecord) => call((r) => r.count(args)),
    aggregate: (args?: AnyRecord) => call((r) => r.aggregate(args)),
    groupBy: (args: AnyRecord) => call((r) => r.groupBy(args)),
    create: (args: AnyRecord) => call((r) => r.create(args)),
    createMany: (args: AnyRecord) => call((r) => r.createMany(args, false)),
    createManyAndReturn: (args: AnyRecord) => call((r) => r.createMany(args, true)),
    update: (args: AnyRecord) => call((r) => r.update(args)),
    updateMany: (args: AnyRecord) => call((r) => r.updateMany(args, false)),
    updateManyAndReturn: (args: AnyRecord) => call((r) => r.updateMany(args, true)),
    upsert: (args: AnyRecord) => call((r) => r.upsert(args)),
    delete: (args: AnyRecord) => call((r) => r.delete(args)),
    deleteMany: (args?: AnyRecord) => call((r) => r.deleteMany(args)),
    raw: () => call(async (r) => (await r.tbl.compile()).t),
    sync: (opts?: { dryRun?: boolean }) => call((r) => r.tbl.reconcile(opts?.dryRun ?? false)),
    drop: () => call((r) => r.tbl.drop()),
  };
  traceOps(
    name,
    model,
    Object.keys(model).filter((op) => !['name', 'raw', 'sync', 'drop'].includes(op)),
  );
  registerModel({
    name,
    sync: model.sync,
    drop: model.drop,
    findByIds: (ids) => model.findMany({ where: { id: { in: ids } } }),
    pgTarget: () => ({ table: rt().tbl.table, idKind: rt().tbl.idKind }),
  });
  return model;
}

/**
 * Defines a PostgreSQL-native model with Prisma's query vocabulary — `findMany`,
 * `findUnique`, `upsert`, `groupBy`, `aggregate` — and SQL types (`integer`, `bigint`,
 * `decimal`, `varchar`, native arrays and enums, serial ids). Record, input, filter and
 * result types are inferred from the schema. Throws at first use on a MongoDB connection.
 */
export function defineTable<const S extends TableSchema, const O extends TableOptions = object>(
  name: string,
  schema: S,
  options?: O,
): TableModel<S, O> {
  return createTable(name, schema, options ?? {}) as unknown as TableModel<S, O>;
}
