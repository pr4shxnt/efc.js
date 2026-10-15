// Types for defineTable — the PostgreSQL-native, Prisma-style model API. Everything is
// derived from the schema literal (`S`) and the options (`O`): records, create input,
// filters, update operations, select/omit results, unique lookups and aggregates.
import type {
  InferCreateInput,
  InferSchema,
  Simplify,
  TableOptions,
  TableSchema,
} from './types.js';

// ── Records ──────────────────────────────────────────────────────────────────

/** `id`'s type from `options.id`: uuid → string, serial → number, bigserial → bigint. */
type IdOf<O> = O extends { id: 'serial' }
  ? number
  : O extends { id: 'bigserial' }
    ? bigint
    : string;

/** A row of the table, as every read returns it. */
export type TableRecord<S, O = object> = Simplify<{ id: IdOf<O> } & InferSchema<S, O>>;

/** The data `create()` accepts. */
export type TableCreateInput<S> = InferCreateInput<S>;

type FieldKind<F> = F extends readonly [unknown]
  ? 'json'
  : F extends { type: 'array'; of: infer Of }
    ? Of extends 'object' | 'json'
      ? 'json'
      : Of extends string
        ? 'list'
        : 'json'
    : F extends { type: 'array' | 'object' | 'json' }
      ? 'json'
      : F extends { type: 'number' | 'integer' | 'bigint' | 'decimal' }
        ? 'number'
        : F extends { type: 'string' }
          ? 'string'
          : F extends { type: string }
            ? 'scalar'
            : 'json'; // nested-schema shorthand

/** Schema keys + id + timestamps, each with its kind. */
type Kinds<S, O> = { [K in keyof S]: FieldKind<S[K]> } & {
  id: O extends { id: 'serial' | 'bigserial' } ? 'number' : 'scalar';
} & {
  [K in keyof TimestampKeys<S, O>]: 'scalar';
};
type TimestampKeys<S, O> = Omit<InferSchema<S, O>, keyof S>;

/** What a filter / write accepts for each field (create-input types; dates also as strings). */
type Inputs<S, O> = {
  [K in keyof TableRecord<S, O>]-?: K extends keyof TableCreateInput<S>
    ? Exclude<TableCreateInput<S>[K], undefined>
    : TableRecord<S, O>[K] extends Date
      ? Date | string
      : K extends 'id'
        ? O extends { id: 'bigserial' }
          ? bigint | number
          : TableRecord<S, O>[K]
        : TableRecord<S, O>[K];
};

type KindOf<S, O, K> = K extends keyof Kinds<S, O> ? Kinds<S, O>[K] : 'scalar';
type KeysOfKind<S, O, Kd> = {
  [K in keyof TableRecord<S, O>]-?: KindOf<S, O, K> extends Kd ? K : never;
}[keyof TableRecord<S, O>] &
  string;

/** Fields that hold one scalar value: sortable, groupable, min/max-able. */
export type TableScalarKeys<S, O = object> = KeysOfKind<S, O, 'scalar' | 'string' | 'number'>;
/** Fields `_sum` / `_avg` / `increment` apply to. */
export type TableNumericKeys<S, O = object> = KeysOfKind<S, O, 'number'>;

// ── Filters ──────────────────────────────────────────────────────────────────

export interface ScalarFilter<V> {
  equals?: V | null;
  not?: V | null | ScalarFilter<V>;
  in?: V[];
  notIn?: V[];
  lt?: V;
  lte?: V;
  gt?: V;
  gte?: V;
}

export interface StringFilter<V> extends Omit<ScalarFilter<V>, 'not'> {
  not?: V | null | StringFilter<V>;
  contains?: string;
  startsWith?: string;
  endsWith?: string;
  /** `'insensitive'` → case-insensitive matching (ILIKE). */
  mode?: 'default' | 'insensitive';
}

/** Filters for scalar lists (native PostgreSQL arrays). */
export interface ListFilter<I> {
  equals?: I[] | null;
  has?: I | null;
  hasEvery?: I[];
  hasSome?: I[];
  isEmpty?: boolean;
}

/** Filters for jsonb fields (embedded objects, arrays of objects, `json`), optionally at a `path`. */
export interface JsonFilter {
  path?: string[];
  equals?: unknown;
  not?: unknown;
  string_contains?: string;
  string_starts_with?: string;
  string_ends_with?: string;
  array_contains?: unknown;
  gt?: number | string | Date;
  gte?: number | string | Date;
  lt?: number | string | Date;
  lte?: number | string | Date;
  mode?: 'default' | 'insensitive';
}

type FieldWhere<Kd, V> = Kd extends 'json'
  ? JsonFilter | V | null
  : Kd extends 'list'
    ? ListFilter<V extends readonly (infer I)[] ? I : never> | V | null
    : Kd extends 'string'
      ? StringFilter<V> | V | null
      : ScalarFilter<V> | V | null;

export type TableWhere<S, O = object> = {
  [K in keyof TableRecord<S, O>]?: FieldWhere<KindOf<S, O, K>, Inputs<S, O>[K]> | undefined;
} & {
  AND?: TableWhere<S, O> | TableWhere<S, O>[];
  OR?: TableWhere<S, O>[];
  NOT?: TableWhere<S, O> | TableWhere<S, O>[];
};

type UniqueFields<S> = { [K in keyof S]: S[K] extends { unique: true } ? K : never }[keyof S];
type CompoundUniques<O> = O extends { indexes: readonly (infer X)[] }
  ? X extends { unique: true; fields: infer F }
    ? F
    : never
  : never;
/** All of `Keys` at once (a compound key is not split into its fields). */
type Selector<S, O, Keys> = [Keys] extends [never]
  ? never
  : { [P in Extract<keyof Inputs<S, O>, Keys>]: Inputs<S, O>[P] };
/** One selector per key in the union. */
type EachSelector<S, O, Keys> = Keys extends PropertyKey ? Selector<S, O, Keys> : never;

/**
 * A `where` that names one record: `id`, a `unique` field, or every field of a unique
 * index — optionally with more filters.
 */
export type TableWhereUnique<S, O = object> = (
  | Selector<S, O, 'id'>
  | EachSelector<S, O, UniqueFields<S>>
  | (CompoundUniques<O> extends infer F
      ? F extends object
        ? Selector<S, O, keyof F>
        : never
      : never)
) &
  TableWhere<S, O>;

// ── Ordering, projection ─────────────────────────────────────────────────────

type SortOrder = 'asc' | 'desc';
export type TableOrderBy<S, O = object> = {
  [K in TableScalarKeys<S, O>]?: SortOrder | { sort: SortOrder; nulls?: 'first' | 'last' };
};

export type TableSelect<S, O = object> = { [K in keyof TableRecord<S, O>]?: boolean };

/** The record narrowed by `select` / `omit`, as Prisma does it. */
export type TablePayload<R, A> = A extends { select: infer Sel }
  ? Simplify<{
      [K in keyof R as K extends keyof Sel ? (Sel[K] extends true ? K : never) : never]: R[K];
    }>
  : A extends { omit: infer Om }
    ? Simplify<{
        [K in keyof R as K extends keyof Om ? (Om[K] extends true ? never : K) : K]: R[K];
      }>
    : R;

type Projection<S, O> =
  | { select?: TableSelect<S, O>; omit?: never }
  | { omit?: TableSelect<S, O>; select?: never };

// ── Arguments ────────────────────────────────────────────────────────────────

export type TableFindManyArgs<S, O = object> = {
  where?: TableWhere<S, O>;
  orderBy?: TableOrderBy<S, O> | TableOrderBy<S, O>[];
  /** Page size; negative reads backwards (from the end, or before `cursor`). */
  take?: number;
  skip?: number;
  /** Start at this record (inclusive — add `skip: 1` to start after it). */
  cursor?: TableWhereUnique<S, O>;
  /** One record per distinct combination of these fields (the first in `orderBy`). */
  distinct?: TableScalarKeys<S, O>[];
} & Projection<S, O>;

export type TableFindUniqueArgs<S, O = object> = { where: TableWhereUnique<S, O> } & Projection<
  S,
  O
>;

type NumberOp<V> = { set?: V | null; increment?: V; decrement?: V; multiply?: V; divide?: V };
type ListOp<V> = { set?: V | null; push?: (V extends readonly (infer I)[] ? I : never) | V };

/** Update data: values (`null` unsets) or Prisma operations per field kind. */
export type TableUpdateData<S, O = object> = {
  [K in keyof TableCreateInput<S>]?:
    | Inputs<S, O>[K & keyof Inputs<S, O>]
    | null
    | undefined
    | (KindOf<S, O, K> extends 'number'
        ? NumberOp<Inputs<S, O>[K & keyof Inputs<S, O>]>
        : KindOf<S, O, K> extends 'list'
          ? ListOp<Inputs<S, O>[K & keyof Inputs<S, O>]>
          : KindOf<S, O, K> extends 'json'
            ? never
            : { set?: Inputs<S, O>[K & keyof Inputs<S, O>] | null });
};

type AggFields<Keys extends string> = { [K in Keys]?: true };
export type TableAggregateArgs<S, O = object> = Omit<
  TableFindManyArgs<S, O>,
  'select' | 'omit' | 'distinct'
> & {
  _count?: true | ({ _all?: true } & AggFields<keyof TableRecord<S, O> & string>);
  _sum?: AggFields<TableNumericKeys<S, O>>;
  _avg?: AggFields<TableNumericKeys<S, O>>;
  _min?: AggFields<TableScalarKeys<S, O>>;
  _max?: AggFields<TableScalarKeys<S, O>>;
};

type SumOf<S, K> = K extends keyof S
  ? S[K] extends { type: 'bigint' }
    ? bigint
    : S[K] extends { type: 'decimal' }
      ? string
      : number
  : number;
type AvgOf<S, K> = K extends keyof S
  ? S[K] extends { type: 'decimal' }
    ? string
    : number
  : number;

/** What `aggregate()` / `groupBy()` return for the requested aggregates. */
export type TableAggregateResult<S, O, A> = Simplify<
  (A extends { _count: infer C }
    ? { _count: C extends true ? number : { -readonly [K in keyof C]: number } }
    : unknown) &
    (A extends { _sum: infer X }
      ? { _sum: { -readonly [K in keyof X]: SumOf<S, K> | null } }
      : unknown) &
    (A extends { _avg: infer X }
      ? { _avg: { -readonly [K in keyof X]: AvgOf<S, K> | null } }
      : unknown) &
    (A extends { _min: infer X }
      ? {
          _min: {
            -readonly [K in keyof X & keyof TableRecord<S, O>]: NonNullable<
              TableRecord<S, O>[K]
            > | null;
          };
        }
      : unknown) &
    (A extends { _max: infer X }
      ? {
          _max: {
            -readonly [K in keyof X & keyof TableRecord<S, O>]: NonNullable<
              TableRecord<S, O>[K]
            > | null;
          };
        }
      : unknown)
>;

type AggFilter = {
  equals?: number | string | bigint;
  not?: number | string | bigint;
  gt?: number | string | bigint;
  gte?: number | string | bigint;
  lt?: number | string | bigint;
  lte?: number | string | bigint;
};
export type TableHaving<S, O = object> = {
  [K in TableScalarKeys<S, O>]?:
    | FieldWhere<KindOf<S, O, K>, Inputs<S, O>[K & keyof Inputs<S, O>]>
    | {
        _count?: AggFilter;
        _sum?: AggFilter;
        _avg?: AggFilter;
        _min?: AggFilter;
        _max?: AggFilter;
      };
} & {
  AND?: TableHaving<S, O> | TableHaving<S, O>[];
  OR?: TableHaving<S, O>[];
  NOT?: TableHaving<S, O> | TableHaving<S, O>[];
};

type AggOrder<Keys extends string> = { [K in Keys]?: SortOrder };
export type TableGroupByArgs<S, O = object> = {
  by: TableScalarKeys<S, O>[];
  where?: TableWhere<S, O>;
  having?: TableHaving<S, O>;
  orderBy?: GroupOrder<S, O> | GroupOrder<S, O>[];
  take?: number;
  skip?: number;
} & Pick<TableAggregateArgs<S, O>, '_count' | '_sum' | '_avg' | '_min' | '_max'>;
type GroupOrder<S, O> = TableOrderBy<S, O> & {
  _count?: AggOrder<keyof TableRecord<S, O> & string>;
  _sum?: AggOrder<TableNumericKeys<S, O>>;
  _avg?: AggOrder<TableNumericKeys<S, O>>;
  _min?: AggOrder<TableScalarKeys<S, O>>;
  _max?: AggOrder<TableScalarKeys<S, O>>;
};

export type TableCountArgs<S, O = object> = Omit<TableFindManyArgs<S, O>, 'select' | 'omit'> & {
  /** Count non-null values per field: `{ _all: true, email: true }` → `{ _all, email }`. */
  select?: { _all?: true } & AggFields<keyof TableRecord<S, O> & string>;
};

// ── The model ────────────────────────────────────────────────────────────────

/**
 * A `defineTable` model: PostgreSQL-native, Prisma-style. Reads and writes return records
 * typed from the schema, narrowed by `select` / `omit`.
 */
export interface TableModel<S, O = object> {
  readonly name: string;
  /** Type-level only (always `undefined`): what `InferRecord` / `InferCreate` read. */
  readonly $types?: { record: TableRecord<S, O>; create: TableCreateInput<S> };
  findMany<const A extends TableFindManyArgs<S, O>>(
    args?: A,
  ): Promise<TablePayload<TableRecord<S, O>, A>[]>;
  findFirst<const A extends TableFindManyArgs<S, O>>(
    args?: A,
  ): Promise<TablePayload<TableRecord<S, O>, A> | null>;
  /** Like `findFirst`, but 404 (`HttpError`) when nothing matches. */
  findFirstOrThrow<const A extends TableFindManyArgs<S, O>>(
    args?: A,
  ): Promise<TablePayload<TableRecord<S, O>, A>>;
  findUnique<const A extends TableFindUniqueArgs<S, O>>(
    args: A,
  ): Promise<TablePayload<TableRecord<S, O>, A> | null>;
  /** Like `findUnique`, but 404 (`HttpError`) when nothing matches. */
  findUniqueOrThrow<const A extends TableFindUniqueArgs<S, O>>(
    args: A,
  ): Promise<TablePayload<TableRecord<S, O>, A>>;
  count<const A extends TableCountArgs<S, O>>(
    args?: A,
  ): Promise<A extends { select: infer Sel } ? { -readonly [K in keyof Sel]: number } : number>;
  aggregate<const A extends TableAggregateArgs<S, O>>(
    args: A,
  ): Promise<TableAggregateResult<S, O, A>>;
  groupBy<const A extends TableGroupByArgs<S, O>>(
    args: A,
  ): Promise<
    Simplify<
      {
        [K in A['by'][number] & keyof TableRecord<S, O>]: NonNullable<TableRecord<S, O>[K]> | null;
      } & TableAggregateResult<S, O, A>
    >[]
  >;
  create<const A extends { data: TableCreateInput<S> } & Projection<S, O>>(
    args: A,
  ): Promise<TablePayload<TableRecord<S, O>, A>>;
  /** Inserts many rows in one statement; `skipDuplicates` → `ON CONFLICT DO NOTHING`. */
  createMany(args: {
    data: TableCreateInput<S> | TableCreateInput<S>[];
    skipDuplicates?: boolean;
  }): Promise<{
    count: number;
  }>;
  createManyAndReturn<
    const A extends {
      data: TableCreateInput<S> | TableCreateInput<S>[];
      skipDuplicates?: boolean;
    } & Projection<S, O>,
  >(
    args: A,
  ): Promise<TablePayload<TableRecord<S, O>, A>[]>;
  /** Updates the record `where` names; 404 if there is none. */
  update<
    const A extends { where: TableWhereUnique<S, O>; data: TableUpdateData<S, O> } & Projection<
      S,
      O
    >,
  >(
    args: A,
  ): Promise<TablePayload<TableRecord<S, O>, A>>;
  updateMany(args: {
    where?: TableWhere<S, O>;
    data: TableUpdateData<S, O>;
  }): Promise<{ count: number }>;
  updateManyAndReturn<
    const A extends { where?: TableWhere<S, O>; data: TableUpdateData<S, O> } & Projection<S, O>,
  >(
    args: A,
  ): Promise<TablePayload<TableRecord<S, O>, A>[]>;
  /**
   * One `INSERT … ON CONFLICT (<unique key>) DO UPDATE` — atomic, race-free. `where` must
   * name a unique key; its values fill `create` when missing there.
   */
  upsert<
    const A extends {
      where: TableWhereUnique<S, O>;
      create: TableCreateInput<S>;
      update: TableUpdateData<S, O>;
    } & Projection<S, O>,
  >(
    args: A,
  ): Promise<TablePayload<TableRecord<S, O>, A>>;
  /** Deletes the record `where` names and returns it; 404 if there is none. */
  delete<const A extends { where: TableWhereUnique<S, O> } & Projection<S, O>>(
    args: A,
  ): Promise<TablePayload<TableRecord<S, O>, A>>;
  deleteMany(args?: { where?: TableWhere<S, O> }): Promise<{ count: number }>;
  /** The Drizzle `pgTable` behind the model. */
  raw(): Promise<unknown>;
  sync(options?: { dryRun?: boolean }): Promise<string[]>;
  drop(): Promise<void>;
}

/** The record type of a `defineTable` model: `type Order = InferTableRecord<typeof Order>`. */
export type InferTableRecord<M> = M extends { $types?: { record: infer R } } ? R : never;

export type { TableOptions, TableSchema };
