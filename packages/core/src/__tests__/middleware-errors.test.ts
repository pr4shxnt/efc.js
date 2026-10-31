import { it, expect, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestApp } from '../testing.js';
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function fixture(source = 'export const GET=(_req,res)=>res.json({ok:true});') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-middleware-errors-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'test.mjs'), source);
  return dir;
}
it('catches async file middleware rejection instead of crashing or hanging the worker', async () => {
  const app = await createTestApp({
    apiDir: fixture(
      'export const middlewares=[async()=>{await Promise.resolve();throw new Error("secret failure")}];export const GET=(_req,res)=>res.json({protected:true});',
    ),
  });
  const res = await request(app).get('/v1/api/test');
  expect(res.status).toBe(500);
  expect(res.body).toEqual({ error: 'Internal Server Error', statusCode: 500 });
});
it('catches global middleware rejections and preserves async custom error handlers', async () => {
  const app = await createTestApp({
    apiDir: fixture(),
    globalMiddlewares: [
      async () => {
        await Promise.resolve();
        throw new Error('failure');
      },
    ],
    onError: async (_err, _req, res, _next) => {
      await Promise.resolve();
      res.status(503).json({ handled: true });
    },
  });
  const res = await request(app).get('/v1/api/test');
  expect(res.status).toBe(503);
  expect(res.body).toEqual({ handled: true });
});
it('forwards rejected async error handlers to Express rather than creating unhandled rejections', async () => {
  const app = await createTestApp({
    apiDir: fixture('export const GET=()=>{throw new Error("first")};'),
    onError: async () => {
      await Promise.resolve();
      throw new Error('second');
    },
  });
  const response = await request(app).get('/v1/api/test');
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ error: 'Internal Server Error', statusCode: 500 });
});
it('keeps next route skips and fails boot for invalid middleware entries', async () => {
  const app = await createTestApp({
    apiDir: fixture(
      'export const middlewares=[async(_req,_res,next)=>{await Promise.resolve();next("route")}];export const GET=(_req,res)=>res.json({protected:true});',
    ),
  });
  expect((await request(app).get('/v1/api/test')).status).toBe(404);
  await expect(
    createTestApp({ apiDir: fixture('export const middlewares=[null];export const GET=()=>{};') }),
  ).rejects.toThrow('Middleware must be a function');
});

it('closes partially written responses when a handler fails instead of hanging the connection', async () => {
  const app = await createTestApp({
    apiDir: fixture(
      'export const GET=(_req,res)=>{res.write("partial");throw new Error("failed after headers");};',
    ),
  });
  await expect(request(app).get('/v1/api/test')).rejects.toThrow();
});
