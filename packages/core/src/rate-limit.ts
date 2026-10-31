import type { Request, RequestHandler } from 'express';
import { isCacheConfigured, rawIncr } from './cache/index.js';
import { getLogger } from './logger.js';

// rateLimit(): a fixed-window limit (windows aligned to the clock) counted in the cache
// (`cache.incr`), so every worker — and with Redis every instance — shares one count. An
// in-memory counter per worker would let N workers accept N × max.

export interface RateLimitOptions {
  /** Window length: seconds, or `'30s'`, `'15m'`, `'1h'`, `'1d'`. */
  window: number | string;
  /** Requests allowed per window and key. */
  max: number;
  /**
   * Who a request counts against. Default: the client IP (`req.ip`) — behind a proxy or load
   * balancer set `trustProxy` in ignite(), or every client shares the proxy's IP. Return
   * `undefined` to not limit this request.
   */
  key?: (req: Request) => string | undefined;
  /**
   * Which counter: requests to routes with the same name share a limit. Default: the route
   * pattern (`/users/:id`), so each route file has its own — or the path, for middleware
   * that isn't on a route.
   */
  name?: string;
  /** Body of the 429 response. Default: `'Too many requests, try again later'`. */
  message?: string;
  /**
   * The cache can't be reached: `'allow'` (default) lets requests through — a limiter
   * shouldn't take the API down with it; `'reject'` answers 503.
   */
  onCacheError?: 'allow' | 'reject';
  /** Send `RateLimit-Limit/Remaining/Reset` (and `Retry-After` on 429). Default: true. */
  headers?: boolean;
}

const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };

export function parseWindow(window: number | string): number {
  let seconds = typeof window === 'number' ? window : NaN;
  if (typeof window === 'string') {
    const match = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)$/.exec(window.trim());
    if (match) seconds = Number(match[1]) * UNITS[match[2]!]!;
  }
  if (Number.isFinite(seconds) && seconds * 1000 >= 1 && seconds * 1000 <= Number.MAX_SAFE_INTEGER)
    return seconds;
  throw new Error(`[EFC] rateLimit: window must be seconds or like '15m' — got ${String(window)}`);
}

let lastCacheError = 0;

/**
 * Limits requests per key (default: client IP) to `max` per `window`, counted in the cache
 * so the limit holds across every worker and instance:
 *
 * ```ts
 * export const middlewares = [rateLimit({ window: '15m', max: 10 })];
 * ```
 *
 * Needs `cache` in ignite() — use the Redis backend when you run more than one instance.
 */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  const windowSeconds = parseWindow(options.window);
  if (!Number.isSafeInteger(options.max) || options.max < 1) {
    throw new Error('[EFC] rateLimit: max must be a positive integer');
  }
  const keyOf = options.key ?? ((req: Request) => req.ip ?? req.socket.remoteAddress);
  const message = options.message ?? 'Too many requests, try again later';
  const headers = options.headers ?? true;

  return (req, res, next) => {
    void (async () => {
      const who = keyOf(req);
      if (who === undefined) return next();
      if (!isCacheConfigured()) {
        throw new Error('[EFC] rateLimit needs a cache — pass cache: { backend } to ignite()');
      }
      const bucket = options.name ?? req.baseUrl + (req.route?.path ?? req.path);
      // Windows are aligned to the clock: every key restarts at the same boundary, and the
      // reset is exact. The key outlives its window by a second, then expires.
      const windowMs = windowSeconds * 1000;
      const now = Date.now();
      const slot = Math.floor(now / windowMs);
      const resetMs = (slot + 1) * windowMs - now;
      let count: number;
      try {
        count = (
          await rawIncr(
            `rl:${JSON.stringify([String(bucket), who, slot])}`,
            Math.ceil(resetMs / 1000) + 1,
          )
        ).value;
      } catch (err) {
        if (Date.now() - lastCacheError > 30_000) {
          lastCacheError = Date.now();
          getLogger().error(
            { err },
            `rateLimit: cache unavailable — ${options.onCacheError === 'reject' ? 'rejecting with 503' : 'allowing requests'}`,
          );
        }
        if (options.onCacheError === 'reject') {
          res.status(503).json({ error: 'Service Unavailable', statusCode: 503 });
          return;
        }
        return next();
      }
      const resetSeconds = Math.max(1, Math.ceil(resetMs / 1000));
      if (headers) {
        res.setHeader('RateLimit-Limit', String(options.max));
        res.setHeader('RateLimit-Remaining', String(Math.max(0, options.max - count)));
        res.setHeader('RateLimit-Reset', String(resetSeconds));
      }
      if (count > options.max) {
        if (headers) res.setHeader('Retry-After', String(resetSeconds));
        res.status(429).json({ error: message, statusCode: 429 });
        return;
      }
      next();
    })().catch(next);
  };
}
