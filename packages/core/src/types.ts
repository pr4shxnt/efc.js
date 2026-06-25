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
  cluster?: boolean;
  workers?: number;
  tasks?: TaskConfig | false;
  cors?: boolean | CorsConfig;
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

export interface RouteMeta {
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

export interface FieldDefinition {
  type: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array';
  required?: boolean;
  unique?: boolean;
  default?: unknown;
}

export type ModelSchema = Record<string, FieldDefinition>;

export interface ModelCRUD<T extends Record<string, any>> {
  find(filter?: Partial<T>): Promise<T[]>;
  findById(id: string): Promise<(T & { id: string }) | null>;
  findOne(filter: Partial<T>): Promise<(T & { id: string }) | null>;
  create(data: Partial<T>): Promise<T & { id: string }>;
  update(id: string, data: Partial<T>): Promise<(T & { id: string }) | null>;
  delete(id: string): Promise<void>;
  count(filter?: Partial<T>): Promise<number>;
}
