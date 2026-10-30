import { afterEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const cache = vi.hoisted(() => new Map<string, string>());
vi.mock('../../cache/index.js', () => ({
  isCacheConfigured: () => true,
  rawGet: async (key: string) => cache.get(key) ?? null,
  rawSet: async (key: string, value: string) => {
    cache.set(key, value);
  },
  revocationFailureMode: () => 'reject',
}));
import { configureAuth, signToken, revokeAllSessions, requireAuth } from '../../auth/index.js';

afterEach(() => {
  cache.clear();
  vi.restoreAllMocks();
});
it('rejects stale authentication signed after revocation, including same-millisecond races', async () => {
  configureAuth({ secret: 'authentication-race', strategy: 'bearer', expiresIn: '1h' });
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const authenticatedAt = now;
  await revokeAllSessions('one');
  now += 10;
  const app = express().get('/', requireAuth, (_req, res) => res.json({ ok: true }));
  const stale = await signToken({ id: 'one', efc_auth_at: authenticatedAt });
  expect((await request(app).get('/').auth(stale, { type: 'bearer' })).status).toBe(401);
  const fresh = await signToken({ id: 'one', efc_auth_at: now });
  expect((await request(app).get('/').auth(fresh, { type: 'bearer' })).status).toBe(200);
  // A future auth timestamp can never override the server-issued time.
  await revokeAllSessions('one');
  const future = await signToken({ id: 'one', efc_auth_at: now + 100000 });
  expect((await request(app).get('/').auth(future, { type: 'bearer' })).status).toBe(401);
});
