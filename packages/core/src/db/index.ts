// Thread-local DB client populated during Pre-Flight.
// The Proxy ensures callers import `db` once and never null-check it —
// it throws with a helpful message if accessed before Pre-Flight completes.

type AnyClient = Record<string, unknown>;

let _client: AnyClient | null = null;

export function setDbClient(client: AnyClient): void {
  _client = client;
}

export function getDbClient(): AnyClient {
  if (!_client) {
    throw new Error('[EFC] db not ready — accessed before Pre-Flight completed');
  }
  return _client;
}

export const db: AnyClient = new Proxy({} as AnyClient, {
  get(_target, prop: string) {
    return getDbClient()[prop];
  },
  set(_target, prop: string, value: unknown) {
    getDbClient()[prop] = value;
    return true;
  },
});

export { connectMongo } from './mongo.js';
export { defineModel } from './model.js';
