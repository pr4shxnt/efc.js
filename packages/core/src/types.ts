import type { RequestHandler, ErrorRequestHandler } from 'express';

export type DatabaseEngine = 'mongodb' | 'postgresql';
export type AuthStrategy = 'http-only' | 'localStorage';
export type TaskBackend = 'bullmq' | 'pg-boss';

export interface TaskConfig {
  backend: TaskBackend;
  redisUrl?: string;
  concurrency?: number;
}

export interface EFCConfig {
  port?: number;
  apiDir: string;
  tasksDir?: string;
  database?: DatabaseEngine;
  databaseUrl?: string;
  authStrategy?: AuthStrategy;
  jwtSecret?: string;
  cluster?: boolean;
  workers?: number;
  tasks?: TaskConfig | false;
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
}

export interface FieldDefinition {
  type: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array';
  required?: boolean;
  unique?: boolean;
  default?: unknown;
}

export type ModelSchema = Record<string, FieldDefinition>;

export interface ModelCRUD<T extends Record<string, unknown>> {
  find(filter?: Partial<T>): Promise<T[]>;
  findById(id: string): Promise<(T & { id: string }) | null>;
  findOne(filter: Partial<T>): Promise<(T & { id: string }) | null>;
  create(data: Partial<T>): Promise<T & { id: string }>;
  update(id: string, data: Partial<T>): Promise<(T & { id: string }) | null>;
  delete(id: string): Promise<void>;
  count(filter?: Partial<T>): Promise<number>;
}
