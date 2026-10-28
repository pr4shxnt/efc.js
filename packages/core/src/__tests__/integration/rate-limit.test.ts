import { describe, it, expect, afterEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import net from 'node:net';
import { cache, configureCache, closeCache } from '../../cache/index.js';
import { rateLimit, parseWindow } from '../../rate-limit.js';
import { parseRedisUrl } from '../../tasks/bullmq-backend.js';
import type { CacheConfig } from '../../types.js';

// cache.incr and rateLimit, on both backends (Redis skips when unreachable). The
// cross-worker case runs in integration/cluster.test.ts against real forked workers.
const REDIS_URL = process.env['EFC_TEST_REDIS_URL'] ?? 'redis://127.0.0.1:6379/15';
function reachable(url: string): Promise<boolean> {
  const { host, port } = parseRedisUrl(url);
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 1000 });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => (socket.destroy(), resolve(false)));
  });
}
const redisAvailable = await reachable(REDIS_URL);
const backends: { name: string; config: () => CacheConfig; skip: boolean }[] = [
  { name: 'memory', config: () => ({ backend: 'memory' }), skip: false },
  {
    name: 'redis',
    config: () => ({
      backend: 'redis',
      url: REDIS_URL,
      prefix: `efcrl:${Math.random().toString(36).slice(2, 8)}:`,
    }),
    skip: !redisAvailable,
  },
];

afterAll(() => closeCache());

function app(...routes: [string, express.RequestHandler][]) {
  const a = express();
  a.set('trust proxy', true);
  for (const [path, mw] of routes) a.get(path, mw, (_req, res) => res.json({ ok: true }));
  return a;
}

for (const b of backends) {
  describe.skipIf(b.skip)(`cache.incr — ${b.name}`, () => {
    afterEach(async () => {
      await cache.clear();
      await closeCache();
    });

    it('counts atomically under concurrency and keeps the first TTL', async () => {
      await configureCache(b.config());
      const counts = await Promise.all(
        Array.from({ length: 200 }, () => cache.incr('hits', { ttl: 60 })),
      );
      expect(new Set(counts).size).toBe(200);
      expect(Math.max(...(counts as number[]))).toBe(200);
      expect(await cache.get('hits')).toBe(200);
    });

    it('expires with the window set by the first increment', async () => {
      await configureCache(b.config());
      expect(await cache.incr('w', { ttl: 1 })).toBe(1);
      expect(await cache.incr('w', { ttl: 100 })).toBe(2); // later TTLs don't extend it
      await new Promise((r) => setTimeout(r, 1300));
      expect(await cache.incr('w', { ttl: 1 })).toBe(1);
    });
  });

  describe.skipIf(b.skip)(`rateLimit — ${b.name}`, () => {
    afterEach(async () => {
      await cache.clear();
      await closeCache();
    });

    it('lets max requests through per window, then answers 429 with Retry-After', async () => {
      await configureCache(b.config());
      const a = app(['/login', rateLimit({ window: '1h', max: 3 })]);
      const statuses: number[] = [];
      let last!: request.Response;
      for (let i = 0; i < 5; i++) {
        last = await request(a).get('/login');
        statuses.push(last.status);
      }
      expect(statuses).toEqual([200, 200, 200, 429, 429]);
      expect(last.body).toEqual({ error: 'Too many requests, try again later', statusCode: 429 });
      expect(last.headers['ratelimit-limit']).toBe('3');
      expect(last.headers['ratelimit-remaining']).toBe('0');
      const reset = Number(last.headers['retry-after']);
      expect(reset).toBeGreaterThan(0);
      expect(reset).toBeLessThanOrEqual(3600);
      expect(last.headers['ratelimit-reset']).toBe(String(reset));
    });

    it('counts per client (trust proxy) and per route; a name shares a limit', async () => {
      await configureCache(b.config());
      const shared = rateLimit({ window: '1h', max: 1, name: 'auth' });
      const a = app(
        ['/a', rateLimit({ window: '1h', max: 1 })],
        ['/b', rateLimit({ window: '1h', max: 1 })],
        ['/c', shared],
        ['/d', shared],
      );
      const from = (ip: string) => ({ 'X-Forwarded-For': ip });
      expect((await request(a).get('/a').set(from('1.1.1.1'))).status).toBe(200);
      expect((await request(a).get('/a').set(from('1.1.1.1'))).status).toBe(429);
      expect((await request(a).get('/a').set(from('2.2.2.2'))).status).toBe(200); // other client
      expect((await request(a).get('/b').set(from('1.1.1.1'))).status).toBe(200); // other route
      expect((await request(a).get('/c').set(from('1.1.1.1'))).status).toBe(200);
      expect((await request(a).get('/d').set(from('1.1.1.1'))).status).toBe(429); // same name
    });

    it('skips requests the key function returns undefined for', async () => {
      await configureCache(b.config());
      const a = app([
        '/k',
        rateLimit({
          window: '1h',
          max: 1,
          key: (req) => (req.query['admin'] ? undefined : 'everyone'),
        }),
      ]);
      expect((await request(a).get('/k')).status).toBe(200);
      expect((await request(a).get('/k')).status).toBe(429);
      expect((await request(a).get('/k?admin=1')).status).toBe(200);
    });
  });
}

describe('rateLimit — failures', () => {
  afterEach(() => closeCache());

  it('allows by default, or answers 503, when the cache is unreachable', async () => {
    await configureCache({ backend: 'redis', url: 'redis://127.0.0.1:1', timeout: 200 });
    const a = app(
      ['/open', rateLimit({ window: '1m', max: 1 })],
      ['/closed', rateLimit({ window: '1m', max: 1, onCacheError: 'reject' })],
    );
    expect((await request(a).get('/open')).status).toBe(200);
    expect((await request(a).get('/open')).status).toBe(200);
    expect((await request(a).get('/closed')).status).toBe(503);
    expect(await cache.incr('x')).toBeUndefined(); // never a made-up count
  });

  it('errors clearly without a cache, and rejects bad options up front', async () => {
    await closeCache();
    const res = await request(app(['/x', rateLimit({ window: 60, max: 1 })])).get('/x');
    expect(res.status).toBe(500);
    expect(() => rateLimit({ window: '15 minutes', max: 1 })).toThrow(/window must be/);
    expect(() => rateLimit({ window: '1m', max: 0 })).toThrow(/max must be/);
    expect([
      parseWindow('30s'),
      parseWindow('15m'),
      parseWindow('1h'),
      parseWindow('1d'),
      parseWindow(2),
    ]).toEqual([30, 900, 3600, 86_400, 2]);
  });
});
