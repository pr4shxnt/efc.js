import { createHash } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { cache } from './index.js';
import { getCurrentUser } from '../context.js';
import { getLogger } from '../logger.js';

export interface CacheResponseOptions {
  /** Seconds to keep a response. */
  ttl: number;
  /** Cache per authenticated string/numeric sub/id. Put requireAuth first. */
  perUser?: boolean;
  /** Custom URL identity. Default: original URL, including query. */
  key?: (req: Request) => string;
}
interface Stored {
  status: number;
  json: string;
  headers: Record<string, string>;
  vary: string[];
  variant: string;
}
export const RESPONSE_PREFIX = 'res:';
const representationHeaders = [
  'content-type',
  'cache-control',
  'vary',
  'content-language',
  'content-disposition',
  'etag',
  'last-modified',
];
const variant = (req: Request, names: string[]) =>
  createHash('sha256')
    .update(JSON.stringify(names.map((name) => [name, req.get(name) ?? null])))
    .digest('hex');

/** Cache successful GET/HEAD JSON representations with method/user isolation. */
export function cacheResponse(options: number | CacheResponseOptions): RequestHandler {
  const opts: CacheResponseOptions = typeof options === 'number' ? { ttl: options } : options;
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let scope = '';
    if (opts.perUser) {
      const user = getCurrentUser();
      const id = user?.['sub'] ?? user?.['id'];
      if (typeof id !== 'string' && (typeof id !== 'number' || !Number.isFinite(id))) return next();
      scope = `u:${JSON.stringify([id])}:`;
    }
    // NUL cannot occur in an HTTP request URL. Keep URL-prefix invalidation while
    // preventing HEAD/GET and legacy-key collisions.
    const key =
      RESPONSE_PREFIX + scope + (opts.key ? opts.key(req) : req.originalUrl) + '\0' + req.method;
    void (async () => {
      const hit = await cache.get<Stored>(key);
      if (
        hit &&
        typeof hit.json === 'string' &&
        Array.isArray(hit.vary) &&
        hit.variant === variant(req, hit.vary)
      ) {
        res.set(hit.headers);
        res.setHeader('X-Cache', 'HIT');
        res.status(hit.status).send(hit.json);
        return;
      }
      res.setHeader('X-Cache', 'MISS');
      let captured = false;
      let snapshot = '';
      // Store the actual serialized JSON, not a mutable application object or a
      // different rendering that ignores Express's JSON replacer.
      const json = res.json.bind(res);
      res.json = (body: unknown) => {
        const send = res.send;
        const eligible = !res.headersSent && res.statusCode === 200;
        res.send = (rendered: unknown) => {
          if (eligible && typeof rendered === 'string') {
            try {
              JSON.parse(rendered);
              snapshot = rendered;
              captured = true;
            } catch {
              /* Not JSON. */
            }
          }
          return send.call(res, rendered);
        };
        try {
          return json(body);
        } finally {
          res.send = send;
        }
      };
      res.once('finish', () => {
        if (!captured || res.statusCode !== 200 || res.getHeader('set-cookie') !== undefined)
          return;
        const control = String(res.getHeader('cache-control') ?? '');
        if (
          /(?:^|,)\s*(?:no-store|no-cache)(?:\s|,|=|$)/i.test(control) ||
          (!opts.perUser && /(?:^|,)\s*private(?:\s|,|=|$)/i.test(control))
        )
          return;
        const vary = String(res.getHeader('vary') ?? '')
          .split(',')
          .map((name) => name.trim().toLowerCase())
          .filter(Boolean);
        if (vary.includes('*')) return;
        const headers: Record<string, string> = {};
        for (const name of representationHeaders) {
          const value = res.getHeader(name);
          if (value !== undefined)
            headers[name] = Array.isArray(value) ? value.join(', ') : String(value);
        }
        const stored: Stored = {
          status: 200,
          json: snapshot,
          headers,
          vary,
          variant: variant(req, vary),
        };
        void cache
          .set(key, stored, { ttl: opts.ttl })
          .catch((error) => getLogger().debug({ err: error }, 'Response cache write failed'));
      });
      next();
    })().catch(next);
  };
}
