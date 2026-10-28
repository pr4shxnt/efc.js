import type { InferRecord, Simplify, SortDirection } from '../types.js';

// A typed aggregation pipeline for defineCollection: each stage method returns a builder
// whose record type is that stage's output, so `group`, `unwind`, `lookup`, `project` and
// `count` results are inferred from the collection's schema. It only collects stage
// objects; `exec()` hands them to the model's `aggregate()`.

type AnyRecord = Record<string, unknown>;
type Elem<V> = V extends readonly (infer E)[] ? E : never;
type Keys<T> = keyof T & string;

/** Values that are objects with fields of their own (not arrays, dates, buffers). */
type Nested<V> = V extends readonly unknown[] | Date | Uint8Array | bigint
  ? never
  : V extends object
    ? V
    : never;
/** A field, or one level into an embedded object: `'name'`, `'address.city'`. */
type Path<T> = Keys<T> | { [K in Keys<T>]: `${K}.${Keys<Nested<NonNullable<T[K]>>>}` }[Keys<T>];

/** `'$field'` / `'$embedded.field'` — a reference to the current record's values. */
export type FieldRef<T> = `$${Path<T>}`;
/** The value a `'$field'` reference (or a literal) resolves to. */
type Ref<T, P> = P extends `$${infer K}.${infer R}`
  ? K extends keyof T
    ? R extends keyof Nested<NonNullable<T[K]>>
      ? Nested<NonNullable<T[K]>>[R]
      : unknown
    : unknown
  : P extends `$${infer K}`
    ? K extends keyof T
      ? T[K]
      : unknown
    : P;
/** `$sum` / `$avg` over a decimal field stay exact strings; numbers stay numbers. */
type Numeric<V> = [NonNullable<V>] extends [string] ? string : number;

export type Accumulator<T> =
  | { $sum: FieldRef<T> | number }
  | { $avg: FieldRef<T> }
  | { $min: FieldRef<T> }
  | { $max: FieldRef<T> }
  | { $first: FieldRef<T> }
  | { $last: FieldRef<T> }
  | { $push: FieldRef<T> }
  | { $addToSet: FieldRef<T> }
  | { $count: Record<string, never> };

type AccResult<T, A> = A extends { $sum: infer F }
  ? F extends number
    ? number
    : Numeric<Ref<T, F>>
  : A extends { $avg: infer F }
    ? Numeric<Ref<T, F>> | null
    : A extends { $count: unknown }
      ? number
      : A extends { $min: infer F } | { $max: infer F } | { $first: infer F } | { $last: infer F }
        ? Ref<T, F>
        : A extends { $push: infer F } | { $addToSet: infer F }
          ? NonNullable<Ref<T, F>>[]
          : unknown;

type GroupKey<T> = FieldRef<T> | null | { [k: string]: FieldRef<T> };
type GroupId<T, I> = I extends null
  ? null
  : I extends string
    ? Ref<T, I>
    : { -readonly [K in keyof I]: Ref<T, I[K]> };

/** `$group` output: `_id` (plus `id`, its string form) and one field per accumulator. */
export type GroupResult<T, G> = Simplify<
  { _id: GroupId<T, G extends { _id: infer I } ? I : null>; id: string } & {
    [K in Exclude<keyof G, '_id'>]: AccResult<T, G[K]>;
  }
>;

/** Fields whose values are arrays. */
type ArrayKeys<T> = {
  [K in Keys<T>]: NonNullable<T[K]> extends readonly unknown[] ? K : never;
}[Keys<T>];

/** `T` with ref field `K` replaced by the `M` record(s) it points to. */
export type LookedUp<T, K extends keyof T, M> = Simplify<
  Omit<T, K> & {
    [P in K]-?: NonNullable<T[K]> extends readonly unknown[]
      ? InferRecord<M>[]
      : InferRecord<M> | null;
  }
>;

/** A model `lookup` can join: anything with inferred record types and a mongoose `raw()`. */
export interface LookupTarget {
  readonly name: string;
  readonly $types?: { record: unknown };
  raw(): Promise<unknown>;
}

type Stage = AnyRecord | (() => Promise<AnyRecord[]>);

export class Pipeline<T> implements PromiseLike<T[]> {
  /** @internal */
  constructor(
    private readonly run: (stages: AnyRecord[]) => Promise<unknown[]>,
    private readonly stages: Stage[] = [],
  ) {}

  private next<U>(...stage: Stage[]): Pipeline<U> {
    return new Pipeline<U>(this.run, [...this.stages, ...stage]);
  }

  /** `$match` — same filter vocabulary as `find`. */
  match(filter: AnyRecord): Pipeline<T> {
    return this.next<T>({ $match: filter });
  }

  sort(spec: Partial<Record<Keys<T>, SortDirection>> & Record<string, SortDirection>): Pipeline<T> {
    return this.next<T>({ $sort: spec });
  }

  skip(n: number): Pipeline<T> {
    return this.next<T>({ $skip: n });
  }

  limit(n: number): Pipeline<T> {
    return this.next<T>({ $limit: n });
  }

  /** `$sample` — `n` random records. */
  sample(n: number): Pipeline<T> {
    return this.next<T>({ $sample: { size: n } });
  }

  /** `$project` with an inclusion spec: the result has only those fields (and `id`). */
  project<const P extends Partial<Record<Keys<T>, 1 | true>>>(
    spec: P,
  ): Pipeline<Simplify<Pick<T, Extract<keyof P, keyof T>> & { id: string }>> {
    return this.next({ $project: spec });
  }

  /**
   * `$unwind` an array field: one result per element, the field holding that element.
   * `preserveNullAndEmptyArrays` keeps records without elements (the field is then null).
   */
  unwind<K extends ArrayKeys<T>, const Keep extends boolean = false>(
    path: `$${K}`,
    options?: { preserveNullAndEmptyArrays?: Keep },
  ): Pipeline<
    Simplify<
      Omit<T, K> & {
        [P in K]-?: Keep extends true ? Elem<NonNullable<T[K]>> | null : Elem<NonNullable<T[K]>>;
      }
    >
  > {
    return this.next(
      options?.preserveNullAndEmptyArrays
        ? { $unwind: { path, preserveNullAndEmptyArrays: true } }
        : { $unwind: path },
    );
  }

  /** `$group` — `_id` is `'$field'`, `null` or `{ key: '$field' }`; accumulators are typed. */
  group<const G extends { _id: GroupKey<T> } & Record<string, unknown>>(
    spec: G & { [K in Exclude<keyof G, '_id'>]: Accumulator<T> },
  ): Pipeline<GroupResult<T, G>> {
    return this.next({ $group: spec });
  }

  /** `$count` — a single `{ [field]: n }` (no result at all when nothing matched). */
  count<const F extends string>(field: F): Pipeline<{ [P in F]: number }> {
    return this.next({ $count: field });
  }

  /** `$addFields` / `$set` — say what the new fields are: `addFields<{ total: number }>({ … })`. */
  addFields<A extends AnyRecord>(
    spec: Record<keyof A, unknown>,
  ): Pipeline<Simplify<Omit<T, keyof A> & A>> {
    return this.next({ $addFields: spec });
  }

  /**
   * `$lookup`. With a field that has a `ref` and its model — `lookup('author', User)` — the
   * field is replaced by the referenced record (or `null`; an array of refs becomes an array
   * of records). Or the full form: `lookup({ from: Review, localField: 'id', foreignField:
   * 'place', as: 'reviews' })` adds `reviews: Review[]`. `id` means `_id` on either side.
   */
  lookup<K extends Keys<T>, M extends LookupTarget>(field: K, from: M): Pipeline<LookedUp<T, K, M>>;
  lookup<M extends LookupTarget, const As extends string>(spec: {
    from: M;
    localField: Keys<T> | `${string}.${string}`;
    foreignField: string;
    as: As;
  }): Pipeline<Simplify<Omit<T, As> & { [P in As]: InferRecord<M>[] }>>;
  lookup(
    a: string | { from: LookupTarget; localField: string; foreignField: string; as: string },
    b?: LookupTarget,
  ): Pipeline<unknown> {
    const idField = (f: string) => (f === 'id' ? '_id' : f);
    if (typeof a === 'string') {
      const field = a;
      const target = b!;
      // Whether the field held an array decides the result's shape; $lookup itself always
      // produces an array, so remember it first.
      const isArray = `__efc_isarr_${field.replace(/\./g, '_')}`;
      return this.next(async () => [
        { $set: { [isArray]: { $isArray: `$${field}` } } },
        {
          $lookup: {
            from: await collectionOf(target),
            localField: field,
            foreignField: '_id',
            as: field,
          },
        },
        {
          $set: {
            [field]: {
              $cond: [
                `$${isArray}`,
                `$${field}`,
                { $ifNull: [{ $arrayElemAt: [`$${field}`, 0] }, null] },
              ],
            },
          },
        },
        { $unset: isArray },
      ]);
    }
    const { from: target, localField, foreignField, as } = a;
    return this.next(async () => [
      {
        $lookup: {
          from: await collectionOf(target),
          localField: idField(localField),
          foreignField: idField(foreignField),
          as,
        },
      },
    ]);
  }

  /** Any other stage, with its output type spelled out: `stage<{ … }>({ $facet: … })`. */
  stage<U = T>(stage: AnyRecord): Pipeline<U> {
    return this.next<U>(stage);
  }

  /** The stages as plain objects (lookups resolved to collection names). */
  async toArray(): Promise<AnyRecord[]> {
    const out: AnyRecord[] = [];
    for (const s of this.stages) {
      if (typeof s === 'function') out.push(...(await s()));
      else out.push(s);
    }
    return out;
  }

  async exec(): Promise<T[]> {
    return (await this.run(await this.toArray())) as T[];
  }

  then<A = T[], B = never>(
    onfulfilled?: ((value: T[]) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.exec().then(onfulfilled, onrejected);
  }
}

async function collectionOf(target: LookupTarget): Promise<string> {
  const model = (await target.raw()) as { collection?: { collectionName?: string; name?: string } };
  const name = model.collection?.collectionName ?? model.collection?.name;
  if (!name) throw new Error(`[EFC] lookup: can't find the collection behind ${target.name}`);
  return name;
}
