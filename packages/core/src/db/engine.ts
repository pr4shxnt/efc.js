import { AsyncLocalStorage } from 'node:async_hooks';
import type { DatabaseEngine } from '../types.js';

// Which adapter defineModel() compiles to. Set during Pre-Flight from
// config.database / the DATABASE_URL scheme; MongoDB until then, which keeps code
// that connects mongoose itself (tests, scripts) working without ignite().
let engine: DatabaseEngine | undefined;

export function setDbEngine(value: DatabaseEngine): void {
  engine = value;
}

export function getDbEngine(): DatabaseEngine {
  return engine ?? 'mongodb';
}

// Whether models reconcile their table/collection on first use (EFCConfig.autoSync).
let autoSync = true;

export function setAutoSync(value: boolean): void {
  autoSync = value;
}

export function isAutoSync(): boolean {
  return autoSync;
}

/** What every model API (defineModel, defineTable) registers about itself. */
export interface RegisteredModel {
  readonly name: string;
  sync(options?: { dryRun?: boolean }): Promise<string[]>;
  drop(): Promise<void>;
  /** Records by id — what `populate` needs from a `ref` target. */
  findByIds(ids: unknown[]): Promise<Record<string, unknown>[]>;
}

// Every defined model by name, so `populate` can resolve a `ref` on either engine
// and `efc db` commands can sync everything that was imported.
const registry = new Map<string, RegisteredModel>();

export function registerModel(model: RegisteredModel): void {
  registry.set(model.name, model);
}

export function getRegisteredModel(name: string): RegisteredModel | undefined {
  return registry.get(name);
}

export function registeredModels(): RegisteredModel[] {
  return [...registry.values()];
}

// ── Transactions ─────────────────────────────────────────────────────────────

/** The open transaction for the current async scope: a mongoose session or a Drizzle tx. */
export type TxHandle =
  | { engine: 'mongodb'; session: unknown }
  | { engine: 'postgresql'; tx: unknown };

const txStorage = new AsyncLocalStorage<TxHandle>();

export function currentTx(): TxHandle | undefined {
  return txStorage.getStore();
}

export function runInTx<T>(handle: TxHandle, fn: () => Promise<T>): Promise<T> {
  return txStorage.run(handle, fn);
}
