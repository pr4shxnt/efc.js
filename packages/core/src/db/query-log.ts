import { AsyncLocalStorage } from 'node:async_hooks';
import type { LoggingConfig } from '../types.js';
import { getRequestContext } from '../context.js';
import { getLogger } from '../logger.js';

// Query logging (`logging.queries`): one event per model operation — model, operation,
// duration, how many database statements it issued, and the request ID — plus slow-query
// warnings and an N+1 detector. Statements are counted at the driver: Drizzle's logger on
// PostgreSQL, mongoose's debug hook on MongoDB.

/** One finished model operation. */
export interface QueryEvent {
  model: string;
  op: string;
  durationMs: number;
  /** Database statements (SQL statements / MongoDB commands) issued, nested calls included. */
  statements: number;
  /** The request it ran in, if any. */
  reqId?: string;
  /** Set when it threw. */
  error?: string;
}

interface Resolved {
  all: boolean;
  slowMs: number;
  nPlusOne: number | false;
}

const DEFAULTS = { slowMs: 500, nPlusOne: 10 } as const;

let config: Resolved | undefined;
const listeners = new Set<(event: QueryEvent) => void>();
const enableHooks: (() => void)[] = [];

/** Called by ignite() during Pre-Flight, next to configureLogger(). */
export function configureQueryLog(logging: LoggingConfig | false | undefined): void {
  const q = logging === false ? undefined : logging?.queries;
  config = !q
    ? undefined
    : q === true
      ? { all: true, ...DEFAULTS }
      : {
          all: q.all ?? false,
          slowMs: q.slowMs ?? DEFAULTS.slowMs,
          nPlusOne: q.nPlusOne ?? DEFAULTS.nPlusOne,
        };
  if (config) for (const hook of enableHooks) hook();
}

function active(): boolean {
  return config !== undefined || listeners.size > 0;
}

/**
 * Receives every model operation while subscribed (whether or not `logging.queries` is
 * on). Returns the unsubscribe function. Internal — tests use it to count statements.
 */
export function onQuery(listener: (event: QueryEvent) => void): () => void {
  listeners.add(listener);
  for (const hook of enableHooks) hook();
  return () => listeners.delete(listener);
}

/** Registers a driver hook to install once query tracking is first needed. */
export function whenQueryTracking(install: () => void): void {
  enableHooks.push(install);
  if (active()) install();
}

interface Frame {
  statements: number;
  parent: Frame | undefined;
}

const frames = new AsyncLocalStorage<Frame | undefined>();

/** Called by the driver hooks for each statement sent to the database. */
export function countStatement(): void {
  for (let f = frames.getStore(); f; f = f.parent) f.statements++;
}

/** Runs `fn` outside any operation, so its statements (e.g. auto-sync) are not counted. */
export function untracked<R>(fn: () => R): R {
  return frames.run(undefined, fn);
}

// The first stack frame outside EFC: the line in the app that made the call.
function callSite(callee: (...args: never[]) => unknown): string | undefined {
  const holder: { stack?: string } = {};
  Error.captureStackTrace(holder, callee);
  const line = holder.stack?.split('\n')[1];
  return line?.trim().replace(/^at /, '');
}

function emit(event: QueryEvent, site: string | undefined, top: boolean): void {
  for (const listener of listeners) listener(event);
  if (!config) return;
  const log = getLogger();
  const msg = `${event.model}.${event.op} ${event.durationMs}ms`;
  // The request's logger already carries reqId.
  const fields: Partial<QueryEvent> = { ...event };
  delete fields.reqId;
  if (event.durationMs >= config.slowMs) {
    log.warn({ ...fields, slow: true }, `Slow query: ${msg}`);
  } else if (config.all) {
    log.info(fields, msg);
  }
  if (top && config.nPlusOne !== false) detectNPlusOne(event, site, config.nPlusOne);
}

function detectNPlusOne(event: QueryEvent, site: string | undefined, threshold: number): void {
  const ctx = getRequestContext();
  if (!ctx) return;
  const key = `${event.model}.${event.op}`;
  const counts = (ctx.queryCounts ??= new Map());
  const n = (counts.get(key) ?? 0) + 1;
  counts.set(key, n);
  if (n !== threshold) return;
  getLogger().warn(
    { model: event.model, op: event.op, count: n, ...(site !== undefined && { site }) },
    `Possible N+1: ${key} ran ${n} times in one request — load them in one query instead`,
  );
}

/**
 * Wraps a model's public operations so each call is timed, its statements counted and
 * the result reported. A no-op wrapper while query logging is off.
 */
export function traceOps<M extends object>(model: string, target: M, ops: readonly string[]): M {
  const t = target as Record<string, unknown>;
  for (const op of ops) {
    const fn = t[op] as (...args: unknown[]) => Promise<unknown>;
    const traced = function (this: unknown, ...args: unknown[]): Promise<unknown> {
      if (!active()) return fn.apply(this, args);
      const parent = frames.getStore();
      const frame: Frame = { statements: 0, parent };
      // Only N+1 checks need the call site; capture it while the caller is on the stack.
      const site = !parent && config && config.nPlusOne !== false ? callSite(traced) : undefined;
      const start = process.hrtime.bigint();
      const finish = (error?: unknown) => {
        const durationMs = Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10;
        const reqId = getRequestContext()?.requestId;
        emit(
          {
            model,
            op,
            durationMs,
            statements: frame.statements,
            ...(reqId !== undefined && { reqId }),
            ...(error !== undefined && { error: (error as Error)?.message ?? String(error) }),
          },
          site,
          !parent,
        );
      };
      return frames
        .run(frame, () => fn.apply(this, args))
        .then(
          (result) => {
            finish();
            return result;
          },
          (err: unknown) => {
            finish(err);
            throw err;
          },
        );
    };
    t[op] = traced;
  }
  return target;
}
