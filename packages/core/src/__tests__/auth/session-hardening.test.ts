import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request } from 'express';
import {
  configureAuth,
  signToken,
  issueToken,
  revokeToken,
  revokeSession,
  revokeAllSessions,
  requireAuth,
} from '../../auth/index.js';
import { configureCache, closeCache, cache } from '../../cache/index.js';
beforeEach(async () => {
  await configureCache({ backend: 'memory', maxEntries: 2 });
  configureAuth({ secret: 'session-hardening-secret', strategy: 'bearer', expiresIn: '2h' });
});
afterEach(async () => {
  await closeCache();
  vi.useRealTimers();
});
const app = () => express().get('/', requireAuth, (_req, res) => res.json({ ok: true }));
const req = (token: string) =>
  ({ headers: { authorization: 'Bearer ' + token } }) as unknown as Request;
it('does not revive revoked sessions when normal cache entries cause LRU pressure', async () => {
  const token = await signToken({ id: 'one' });
  await revokeSession(req(token));
  await cache.set('first', 1);
  await cache.set('second', 2);
  expect((await request(app()).get('/').auth(token, { type: 'bearer' })).status).toBe(401);
});
it('retains user revocation cutoffs after shortening the configured token lifetime', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const start = Date.now();
  const token = await signToken({ id: 'one' });
  vi.setSystemTime(start + 10);
  configureAuth({ secret: 'session-hardening-secret', strategy: 'bearer', expiresIn: '1m' });
  await revokeAllSessions('one');
  vi.setSystemTime(start + 120000);
  expect((await request(app()).get('/').auth(token, { type: 'bearer' })).status).toBe(401);
});
it('clears domain-scoped auth cookies using the same domain at issuance and logout', async () => {
  configureAuth({
    secret: 'session-hardening-secret',
    strategy: 'http-only',
    expiresIn: '1h',
    cookieDomain: '.example.com',
  });
  const server = express()
    .get('/login', async (_req, res) => {
      await issueToken(res, { id: 'one' });
      res.end();
    })
    .get('/logout', (_req, res) => {
      revokeToken(res);
      res.end();
    });
  const login = await request(server).get('/login');
  const logout = await request(server).get('/logout');
  expect(String(login.headers['set-cookie'])).toContain('Domain=.example.com');
  expect(String(logout.headers['set-cookie'])).toContain('Domain=.example.com');
});

it('rejects a revocation write at protected capacity instead of evicting another revoked token', async () => {
  await configureCache({ backend: 'memory', maxEntries: 1 });
  const first = await signToken({ id: 'one' });
  const second = await signToken({ id: 'two' });
  await revokeSession(req(first));
  await expect(revokeSession(req(second))).rejects.toThrow('protected session revocations');
  expect((await request(app()).get('/').auth(first, { type: 'bearer' })).status).toBe(401);
});
it('rejects invalid memory-cache limits before replacing the current revocation store', async () => {
  const token = await signToken({ id: 'one' });
  await revokeSession(req(token));
  for (const maxEntries of [-1, 0, NaN, Infinity])
    await expect(configureCache({ backend: 'memory', maxEntries })).rejects.toThrow(
      'positive safe integer',
    );
  expect((await request(app()).get('/').auth(token, { type: 'bearer' })).status).toBe(401);
});
