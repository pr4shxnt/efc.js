import { it, expect, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { rateLimit, parseWindow } from '../rate-limit.js';
import { configureCache, closeCache } from '../cache/index.js';
afterEach(() => closeCache());
it('rejects non-finite, zero and sub-millisecond limiter windows', () => {
  for (const value of [Infinity, NaN, 0, -1, '0s', '0.0001s', '9'.repeat(400) + 'd'])
    expect(() => parseWindow(value)).toThrow('window');
  expect(parseWindow('0.5s')).toBe(0.5);
  expect(() => rateLimit({ window: 60, max: Number.MAX_SAFE_INTEGER + 1 })).toThrow(
    'positive integer',
  );
});
it('isolates counters whose bucket names and user keys contain colons', async () => {
  await configureCache({ backend: 'memory' });
  const app = express();
  app.get('/one', rateLimit({ window: 60, max: 1, name: '/a:b', key: () => 'x' }), (_req, res) =>
    res.end(),
  );
  app.get('/two', rateLimit({ window: 60, max: 1, name: '/a', key: () => 'b:x' }), (_req, res) =>
    res.end(),
  );
  expect((await request(app).get('/one')).status).toBe(200);
  expect((await request(app).get('/two')).status).toBe(200);
  expect((await request(app).get('/one')).status).toBe(429);
});
