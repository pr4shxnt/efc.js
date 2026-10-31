import type { Context, Span } from '@opentelemetry/api';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from 'pino';
import { processState } from './process-state.js';

export interface RequestContext {
  otelContext?: Context;
  httpSpan?: Span;
  user?: Record<string, unknown> | undefined;
  requestId?: string;
  log?: Logger;
  /** Model operations run so far in this request, by `Model.op` (N+1 detection). */
  queryCounts?: Map<string, number>;
}

const storage = processState('request-context', () => new AsyncLocalStorage<RequestContext>());

// Wraps one request's lifecycle in an AsyncLocalStorage context. Node propagates
// the store through the async chain the callback initiates (awaits, .then, etc.),
// so anything running as part of the same request — including a `$currentUser`
// default resolved deep inside a mongoose `.create()` call — can read it back.
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function setCurrentUser(user: Record<string, unknown> | undefined): void {
  const store = storage.getStore();
  if (store) store.user = user;
}

export function getCurrentUser(): Record<string, unknown> | undefined {
  return storage.getStore()?.user;
}
