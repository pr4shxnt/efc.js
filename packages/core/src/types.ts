import type { RequestHandler, ErrorRequestHandler } from 'express';

export type DatabaseEngine = 'mongodb' | 'postgresql';
export type AuthStrategy = 'http-only' | 'localStorage';
export type TaskBackend = 'bullmq' | 'pg-boss';

export interface TaskConfig {
  backend: TaskBackend;
  redisUrl?: string;
  concurrency?: number;
}

export interface CorsConfig {
  origin?: string | string[] | boolean;
  methods?: string | string[];
  allowedHeaders?: string | string[];
  credentials?: boolean;
  maxAge?: number;
}

export interface EFCConfig {
  port?: number;
  basePath?: string;
  dashboard?: boolean;
  database?: DatabaseEngine;
  databaseUrl?: string;
  authStrategy?: AuthStrategy;
  jwtSecret?: string;
  /** JWT lifetime, e.g. '15m', '1h', '7d'. Default: '7d'. */
  jwtExpiresIn?: string;
  /** Cookie domain for the 'http-only' auth strategy. Default: unset (host-only cookie). */
  cookieDomain?: string;
  cluster?: boolean;
  workers?: number;
  tasks?: TaskConfig | false;
  cors?: boolean | CorsConfig;
  /** Request timeout in milliseconds. Requests exceeding this duration will be terminated with 408. */
  requestTimeout?: number;
  globalMiddlewares?: RequestHandler[];
  onWorkerReady?: (id: number) => void;
  onWorkerCrash?: (id: number, code: number) => void;
  onError?: ErrorRequestHandler;
}

export interface RouteEntry {
  urlPath: string;
  filePath: string;
  params: string[];
}

export interface RouteMethodMeta {
  description?: string;
  request?: {
    headers?: Record<string, string>;
    params?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
  };
  response?: {
    status?: number;
    body?: unknown;
  };
}

/**
 * Keyed by HTTP method (`GET`, `POST`, ...) so each method implemented in a
 * route file gets its own documentation block in the dashboard.
 */
export type RouteMeta = Partial<Record<string, RouteMethodMeta>>;

export interface MountedRoute extends RouteEntry {
  methods: string[];
  meta?: RouteMeta;
}

export interface TaskOptions {
  thread?: boolean;
  retries?: number;
  backoff?: 'fixed' | 'exponential';
  concurrency?: number;
  schedule?: string;
}

export interface TaskDefinition<TPayload = unknown> {
  handler: (payload: TPayload) => Promise<void>;
  options: TaskOptions;
  name: string;
  filePath?: string;
}

/** Primitive field types usable directly, or as the item type of an `array` field via `of`. */
export type PrimitiveFieldType = 'string' | 'number' | 'boolean' | 'date' | 'object' | 'objectId';

export interface FieldDefinition {
  type: PrimitiveFieldType | 'array';
  required?: boolean;
  unique?: boolean;
  default?: unknown;
  /** Restricts the field to a fixed set of values. Valid on `string` and `number` types. */
  enum?: readonly (string | number)[];
  /** Mongoose model name to reference. Valid on `objectId` types (bare or as an array's `of`). */
  ref?: string;
  /** Item type for `array` fields, e.g. `{ type: 'array', of: 'string' }`. Omit for an untyped array. */
  of?: PrimitiveFieldType;
}

/**
 * A schema field is either a `FieldDefinition`, or a one-element tuple holding a nested
 * `ModelSchema` — the latter defines an array of embedded sub-documents, e.g.:
 * `route_progress: [{ route_id: { type: 'string' } }]`
 */
export type ModelSchema = Record<string, FieldDefinition | [ModelSchema]>;

export interface ModelQueryOptions {
  /** Mongoose `.populate()` path(s) to resolve on `objectId`/ref fields. */
  populate?: string | string[];
}

export interface ModelCRUD<T extends Record<string, any>> {
  find(filter?: Partial<T>, options?: ModelQueryOptions): Promise<T[]>;
  findById(id: string, options?: ModelQueryOptions): Promise<(T & { id: string }) | null>;
  findOne(filter: Partial<T>, options?: ModelQueryOptions): Promise<(T & { id: string }) | null>;
  create(data: Partial<T>): Promise<T & { id: string }>;
  update(id: string, data: Partial<T>): Promise<(T & { id: string }) | null>;
  delete(id: string): Promise<void>;
  count(filter?: Partial<T>): Promise<number>;
}
