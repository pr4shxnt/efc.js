import { beforeEach, afterEach, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { configureCache, closeCache, cache } from '../cache/index.js';
import { cacheResponse } from '../cache/response.js';
import { setCurrentUser } from '../context.js';
import { createTestApp } from '../testing.js';
const dirs: string[] = [];
beforeEach(async () => {
  await configureCache({ backend: 'memory' });
});
afterEach(async () => {
  await closeCache();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
it('recovers a cache.wrap key after a synchronous computation failure', async () => {
  await expect(
    cache.wrap('recover', 60, () => {
      throw new Error('temporary');
    }),
  ).rejects.toThrow('temporary');
  expect(await cache.wrap('recover', 60, async () => 42)).toBe(42);
});
it('does not share per-user responses when identifiers and URL paths contain delimiter characters', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-cache-scope-'));
  dirs.push(dir);
  fs.writeFileSync(
    path.join(dir, '[...rest].mjs'),
    'export const GET=(req,res)=>res.json({user:req.get("x-test-user"),url:req.originalUrl});',
  );
  const app = await createTestApp({
    apiDir: dir,
    globalMiddlewares: [
      (req, _res, next) => {
        setCurrentUser({ id: req.get('x-test-user') });
        next();
      },
      cacheResponse({ ttl: 60, perUser: true }),
    ],
  });
  const first = await request(app).get('/v1/api/x:/v1/api/y').set('x-test-user', 'alice');
  expect(first.body.user).toBe('alice');
  const second = await request(app).get('/v1/api/y').set('x-test-user', 'alice:/v1/api/x');
  expect(second.body.user).toBe('alice:/v1/api/x');
  expect(second.headers['x-cache']).toBe('MISS');
});

it('does not let an old cache.wrap completion populate or erase a new cache namespace', async () => {
  let finishOld!: (value: string) => void;
  let finishNew!: (value: string) => void;
  let began!: (value?: unknown) => void;
  const started = new Promise((resolve) => {
    began = resolve;
  });
  const old = cache.wrap('key', 60, () => {
    began();
    return new Promise<string>((resolve) => {
      finishOld = resolve;
    });
  });
  await started;
  await configureCache({ backend: 'memory', prefix: 'new:' });
  let runs = 0;
  const fresh = cache.wrap('key', 60, async () => {
    runs++;
    return new Promise<string>((resolve) => {
      finishNew = resolve;
    });
  });
  await new Promise((r) => setTimeout(r, 0));
  finishOld('old');
  expect(await old).toBe('old');
  expect(await cache.get('key')).toBeUndefined();
  const shared = cache.wrap('key', 60, async () => {
    runs++;
    return 'wrong duplicate';
  });
  await new Promise((r) => setTimeout(r, 0));
  finishNew('new');
  expect(await fresh).toBe('new');
  expect(await shared).toBe('new');
  expect(runs).toBe(1);
  expect(await cache.get('key')).toBe('new');
});
it('honors explicit HEAD handlers and keeps HEAD responses from poisoning GET cache entries', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-cache-head-'));
  dirs.push(dir);
  fs.writeFileSync(
    path.join(dir, 'test.mjs'),
    'export const GET=(_req,res)=>res.set("X-Handler","get").json({value:"GET body"});export const HEAD=(_req,res)=>res.set("X-Handler","head").json({value:"HEAD body"});',
  );
  const app = await createTestApp({ apiDir: dir, globalMiddlewares: [cacheResponse(60)] });
  const head = await request(app).head('/v1/api/test');
  expect(head.headers['x-handler']).toBe('head');
  const get = await request(app).get('/v1/api/test');
  expect(get.body).toEqual({ value: 'GET body' });
  expect(get.headers['x-cache']).toBe('MISS');
  const again = await request(app).head('/v1/api/test');
  expect(again.headers['x-cache']).toBe('HIT');
  await cache.clear('res:/v1/api/test');
  expect((await request(app).get('/v1/api/test')).headers['x-cache']).toBe('MISS');
});

it('respects no-store, wildcard Vary and Set-Cookie, including cookies added at header write time', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-cache-policy-'));
  dirs.push(dir);
  fs.writeFileSync(
    path.join(dir, 'test.mjs'),
    'let n=0;export const GET=(_req,res)=>res.json({n:++n});',
  );
  for (const mode of ['no-store', 'private', 'vary', 'cookie', 'late-cookie']) {
    const app = await createTestApp({
      apiDir: dir,
      globalMiddlewares: [
        (_req, res, next) => {
          if (mode === 'no-store' || mode === 'private') res.set('Cache-Control', mode);
          if (mode === 'vary') res.vary('*');
          if (mode === 'cookie') res.cookie('session', 'secret');
          if (mode === 'late-cookie') {
            const write = res.writeHead;
            res.writeHead = function (...args) {
              res.setHeader('Set-Cookie', 'session=secret');
              return Reflect.apply(write, res, args);
            };
          }
          next();
        },
        cacheResponse({ ttl: 60, key: () => mode }),
      ],
    });
    const first = await request(app).get('/v1/api/test');
    const second = await request(app).get('/v1/api/test');
    expect(second.headers['x-cache'], mode).toBe('MISS');
    expect(second.body.n, mode).toBeGreaterThan(first.body.n);
  }
});
it('matches Vary representations and preserves safe response metadata without storing raw request credentials', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-cache-vary-'));
  dirs.push(dir);
  fs.writeFileSync(
    path.join(dir, 'test.mjs'),
    'export const GET=(req,res)=>res.vary("Accept-Language").set("Content-Language",req.get("accept-language")).set("Cache-Control","public, max-age=60").json({language:req.get("accept-language")});',
  );
  const app = await createTestApp({ apiDir: dir, globalMiddlewares: [cacheResponse(60)] });
  await request(app).get('/v1/api/test').set('Accept-Language', 'en');
  const french = await request(app).get('/v1/api/test').set('Accept-Language', 'fr');
  expect(french.body.language).toBe('fr');
  expect(french.headers['x-cache']).toBe('MISS');
  const cached = await request(app).get('/v1/api/test').set('Accept-Language', 'fr');
  expect(cached.headers['x-cache']).toBe('HIT');
  expect(cached.headers['content-language']).toBe('fr');
  expect(cached.headers['cache-control']).toBe('public, max-age=60');
});
it('caches the serialized response instead of mutations made after res.json', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-cache-snapshot-'));
  dirs.push(dir);
  fs.writeFileSync(
    path.join(dir, 'test.mjs'),
    'export const GET=(_req,res)=>{const body={public:true};res.json(body);body.secret="must not leak";};',
  );
  const app = await createTestApp({ apiDir: dir, globalMiddlewares: [cacheResponse(60)] });
  expect((await request(app).get('/v1/api/test')).body).toEqual({ public: true });
  expect((await request(app).get('/v1/api/test')).body).toEqual({ public: true });
});
it('replays exact JSON bytes without applying the Express replacer twice', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-cache-render-'));
  dirs.push(dir);
  fs.writeFileSync(
    path.join(dir, 'test.mjs'),
    'export const GET=(_req,res)=>res.json({n:2,text:"<tag>"});',
  );
  const app = await createTestApp({ apiDir: dir, globalMiddlewares: [cacheResponse(60)] });
  app.set('json replacer', (_key: string, value: unknown) =>
    typeof value === 'number' ? value * 2 : value,
  );
  app.set('json escape', true);
  const first = await request(app).get('/v1/api/test');
  const second = await request(app).get('/v1/api/test');
  expect(first.body.n).toBe(4);
  expect(second.headers['x-cache']).toBe('HIT');
  expect(second.text).toBe(first.text);
  expect(second.headers.etag).toBe(first.headers.etag);
});
