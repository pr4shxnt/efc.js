import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { jwtVerify } from 'jose';
import { createTestApp } from '../testing.js';
import type * as AuthModule from '../auth/index.js';
import { configureCache, closeCache } from '../cache/index.js';

const dirs: string[] = [];
const authPath = JSON.stringify(path.resolve(import.meta.dirname, '../auth/index.ts'));
const errorPath = JSON.stringify(path.resolve(import.meta.dirname, '../errors.ts'));
function fixture(routes: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-test-app-'));
  dirs.push(dir);
  for (const [name, source] of Object.entries(routes)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  }
  return dir;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('createTestApp', () => {
  it.skipIf(!fs.existsSync(path.resolve(import.meta.dirname, '../../dist/testing.js')))(
    'ships callable ESM and CommonJS testing exports',
    async () => {
      const esm = await import('express-file-cluster/testing');
      const cjs = createRequire(import.meta.url)('express-file-cluster/testing') as {
        createTestApp: typeof createTestApp;
      };
      for (const build of [cjs, esm]) {
        const secret = crypto.randomUUID();
        const packagedAuth = JSON.stringify(
          path.resolve(import.meta.dirname, '../../dist/auth/index.js'),
        );
        const app = await build.createTestApp({
          auth: { secret, strategy: 'bearer' },
          apiDir: fixture({
            'login.js': `import { signToken } from ${packagedAuth}; export const POST = async (_req, res) => res.json({ token: await signToken({ id: 'packaged' }) });`,
            'me.js': `import { requireAuth, getCurrentUser } from ${packagedAuth}; export const middlewares = [requireAuth]; export const GET = (_req, res) => res.json(getCurrentUser());`,
            'health.js': `export const GET = (_req, res) => res.json({ packaged: true });`,
          }),
        });
        expect((await request(app).get('/v1/api/health')).body).toEqual({ packaged: true });
        const login = await request(app).post('/v1/api/login');
        expect(login.status).toBe(200);
        await jwtVerify(login.body.token, new TextEncoder().encode(secret));
        const me = await request(app).get('/v1/api/me').auth(login.body.token, { type: 'bearer' });
        expect(me.status).toBe(200);
        expect(me.body.id).toBe('packaged');
      }
    },
  );

  it.skipIf(!fs.existsSync(path.resolve(import.meta.dirname, '../../dist/testing.js')))(
    'shares CommonJS middleware authentication, request context and revocation with ESM routes',
    async () => {
      const require = createRequire(import.meta.url);
      const helper = require('express-file-cluster/testing') as {
        createTestApp: typeof createTestApp;
      };
      const cjsAuth = require('express-file-cluster/auth') as typeof AuthModule;
      const esmAuth = await import('express-file-cluster/auth');
      const packagedAuth = JSON.stringify(
        path.resolve(import.meta.dirname, '../../dist/auth/index.js'),
      );
      await configureCache({ backend: 'memory', prefix: 'mixed-' + crypto.randomUUID() + ':' });
      try {
        const app = await helper.createTestApp({
          apiDir: fixture({
            'me.mjs': `import { getCurrentUser } from ${packagedAuth}; export const GET = async (_req, res) => { await Promise.resolve(); res.json({ user: getCurrentUser() }); };`,
          }),
          auth: { secret: 'mixed-module-auth', strategy: 'bearer' },
          globalMiddlewares: [cjsAuth.requireAuth],
        });
        const token = await cjsAuth.signToken({ id: 'mixed', efc_auth_at: Date.now() });
        const first = await request(app).get('/v1/api/me').auth(token, { type: 'bearer' });
        expect(first.status).toBe(200);
        expect(first.body.user.id).toBe('mixed');
        await esmAuth.revokeAllSessions('mixed');
        expect((await request(app).get('/v1/api/me').auth(token, { type: 'bearer' })).status).toBe(
          401,
        );
      } finally {
        await closeCache();
      }
    },
  );

  it('mounts separate route trees concurrently without cwd, listeners or signals', async () => {
    const cwd = process.cwd();
    const signals = [process.listenerCount('SIGTERM'), process.listenerCount('SIGINT')];
    const listen = vi.spyOn(express.application, 'listen');
    const [first, second] = await Promise.all([
      createTestApp({
        apiDir: fixture({ 'health.js': `export const GET = (_req, res) => res.json({ app: 1 });` }),
      }),
      createTestApp({
        apiDir: fixture({ 'health.js': `export const GET = (_req, res) => res.json({ app: 2 });` }),
      }),
    ]);
    expect(process.cwd()).toBe(cwd);
    expect(listen).not.toHaveBeenCalled();
    expect([process.listenerCount('SIGTERM'), process.listenerCount('SIGINT')]).toEqual(signals);
    expect((await request(first).get('/v1/api/health')).body).toEqual({ app: 1 });
    expect((await request(second).get('/v1/api/health')).body).toEqual({ app: 2 });
  });

  it('uses the real scanner, route precedence, catch-all decoding and method dispatch', async () => {
    const app = await createTestApp({
      basePath: '/test',
      apiDir: fixture({
        'docs/intro.js': `export const GET = (_req, res) => res.json({ static: true });`,
        'docs/[[...slug]].js': `export const GET = (req, res) => res.json(req.params);`,
      }),
    });
    expect((await request(app).get('/test/docs/intro')).body).toEqual({ static: true });
    expect((await request(app).get('/test/docs')).body).toEqual({ slug: [] });
    expect((await request(app).get('/test/docs/100%25/a%2Fb')).body).toEqual({
      slug: ['100%', 'a/b'],
    });
    const missingMethod = await request(app).post('/test/docs/a/b');
    expect(missingMethod.status).toBe(405);
    expect(missingMethod.headers.allow).toBe('GET');
    expect((await request(app).get('/docs')).status).toBe(404);
  });

  it('parses bodies/cookies and runs global, file and validation middleware in production order', async () => {
    const app = await createTestApp({
      globalMiddlewares: [
        (req, _res, next) => {
          req.headers['x-order'] = 'global';
          next();
        },
      ],
      apiDir: fixture({
        'body.js': `
export const middlewares = [(req, res, next) => { req.headers['x-order'] += ',file'; next(); }];
export const schema = { body: { safeParse: (value) => typeof value.n === 'number' ? { success: true, data: { n: value.n + 1 } } : { success: false, error: { issues: [{ path: ['n'], message: 'number required' }] } } } };
export const POST = (req, res) => res.json({ body: req.body, cookie: req.cookies.session, order: req.headers['x-order'] });`,
      }),
    });
    expect((await request(app).post('/v1/api/body').send({ n: 'bad' })).status).toBe(400);
    const good = await request(app)
      .post('/v1/api/body')
      .set('Cookie', 'session=abc')
      .send({ n: 1 });
    expect(good.body).toEqual({ body: { n: 2 }, cookie: 'abc', order: 'global,file' });
  });

  it('configures bearer auth and preserves AsyncLocalStorage context across awaits', async () => {
    const app = await createTestApp({
      auth: { secret: 'test-app-secret', strategy: 'bearer' },
      apiDir: fixture({
        'login.js': `import { issueToken } from ${authPath}; export const POST = async (_req, res) => res.json({ token: await issueToken(res, { id: 'one', role: 'user' }) });`,
        'me.js': `import { requireAuth, getCurrentUser } from ${authPath}; export const middlewares = [requireAuth]; export const GET = async (_req, res) => { await Promise.resolve(); res.json(getCurrentUser()); };`,
      }),
    });
    expect((await request(app).get('/v1/api/me')).status).toBe(401);
    const login = await request(app).post('/v1/api/login');
    expect(login.headers['set-cookie']).toBeUndefined();
    const me = await request(app).get('/v1/api/me').auth(login.body.token, { type: 'bearer' });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: 'one', role: 'user' });
  });

  it('uses production error handling and honors a custom error handler', async () => {
    const apiDir = fixture({
      'fail.js': `import { HttpError } from ${errorPath}; export const GET = () => { throw new HttpError(422, 'Invalid'); };`,
      'internal.js': `export const GET = () => { throw new Error('private database credentials'); };`,
    });
    const app = await createTestApp({ apiDir });
    expect((await request(app).get('/v1/api/fail')).body).toEqual({
      error: 'Invalid',
      statusCode: 422,
    });
    expect((await request(app).get('/v1/api/internal')).body).toEqual({
      error: 'Internal Server Error',
      statusCode: 500,
    });
    const custom = await createTestApp({
      apiDir,
      onError: (_err, _req, res, _next) => res.status(418).json({ custom: true }),
    });
    expect((await request(custom).get('/v1/api/fail')).body).toEqual({ custom: true });
  });

  it('supports the production timeout and rejects missing fixture directories', async () => {
    const app = await createTestApp({
      requestTimeout: 10,
      apiDir: fixture({
        'slow.js': `export const GET = async () => { await new Promise(resolve => setTimeout(resolve, 30)); };`,
      }),
    });
    expect((await request(app).get('/v1/api/slow')).status).toBe(408);
    await expect(
      createTestApp({ apiDir: path.join(os.tmpdir(), 'efc-missing-' + crypto.randomUUID()) }),
    ).rejects.toThrow('not a directory');
    await expect(createTestApp({ apiDir: '' })).rejects.toThrow('nonempty apiDir');
  });
});
