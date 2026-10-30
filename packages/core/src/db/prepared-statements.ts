import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

const invalidators = new WeakMap<Pool, () => void>();

/** Clear reusable shapes after EFC changes a table; existing server names stay bounded. */
export function invalidatePreparedStatements(pool: Pool): void {
  invalidators.get(pool)?.();
}

/**
 * Private Drizzle driver view. The exported native Pool is unchanged. Each real
 * connection owns its names, including connections checked out for transactions.
 * Once its lifetime budget is full, new shapes use the ordinary unnamed protocol.
 */
export function preparedDriver(pool: Pool, max: number): Pool {
  if (!Number.isSafeInteger(max) || max < 0) {
    throw new Error('[EFC] databasePool.preparedStatements.max must be a nonnegative safe integer');
  }
  if (max === 0) return pool;
  let generation = 0;
  invalidators.set(pool, () => {
    generation++;
  });
  const clients = new WeakMap<PoolClient, PoolClient>();
  const wrap = (client: PoolClient): PoolClient => {
    const existing = clients.get(client);
    if (existing) return existing;
    let allocated = 0;
    let seenGeneration = generation;
    const names = new Map<string, string>();
    const proxy = new Proxy(client, {
      get(target, prop) {
        if (prop === 'query')
          return (...args: unknown[]) => {
            if (seenGeneration !== generation) {
              names.clear();
              seenGeneration = generation;
            }
            const query = args[0];
            if (query && typeof query === 'object' && 'text' in query) {
              const config = query as Record<string, unknown>;
              const text = config.text;
              // No DDL, transaction control, multi-statements, or caller-named queries.
              if (
                !config.name &&
                typeof text === 'string' &&
                /^\s*(select|insert|update|delete|with)\b/i.test(text) &&
                !text.trim().replace(/;$/, '').includes(';')
              ) {
                let name = names.get(text);
                if (!name && allocated < max) {
                  name =
                    'efc_auto_' +
                    createHash('sha256')
                      .update(generation + ':' + text)
                      .digest('hex')
                      .slice(0, 48);
                  names.set(text, name);
                  allocated++;
                }
                if (name) args[0] = { ...config, name };
              }
            }
            return Reflect.apply(target.query, target, args);
          };
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    clients.set(client, proxy);
    return proxy;
  };
  return new Proxy(pool, {
    get(target, prop) {
      if (prop === 'connect') return async () => wrap(await target.connect());
      if (prop === 'query')
        return async (...args: unknown[]) => {
          const client = await target.connect();
          // Match Pool.query's connection-error ownership while checked out: do
          // not leave a network error unhandled, and discard failed connections.
          let failure: Error | undefined;
          const onError = (err: Error) => {
            failure = err;
          };
          client.once('error', onError);
          try {
            return await Reflect.apply(wrap(client).query, wrap(client), args);
          } catch (err) {
            failure = err instanceof Error ? err : new Error(String(err));
            throw err;
          } finally {
            client.removeListener('error', onError);
            client.release(failure);
          }
        };
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
