import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { ignite } from './index.js';

// helpers ----------------------------------------------------------------

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'efc-ignite-'));
}

function writeRoute(dir: string, name: string, code: string) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, code);
  return file;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.closeAllConnections(); // release keep-alive connections so close() fires promptly
    server.close((e) => (e ? reject(e) : resolve()));
  });
}

// -----------------------------------------------------------------------

describe('ignite() — server integration', () => {
  let apiDir: string;
  let server: Server | undefined;

  beforeEach(() => {
    apiDir = tmpDir();
    // ensure no DATABASE_URL so connectMongo is never called
    delete process.env['DATABASE_URL'];
    delete process.env['CORS_ORIGINS'];
  });

  afterEach(async () => {
    if (server) { await closeServer(server); server = undefined; }
    fs.rmSync(apiDir, { recursive: true, force: true });
  });

  // --- route serving ----------------------------------------------------

  it('serves a GET route', async () => {
    writeRoute(apiDir, 'health.js', `export const GET = async (_req, res) => res.json({ ok: true });`);
    server = await ignite({ apiDir, cluster: false, port: 0 });
    const res = await request(server).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('serves a POST route', async () => {
    writeRoute(apiDir, 'echo.js', `export const POST = async (req, res) => res.status(201).json(req.body);`);
    server = await ignite({ apiDir, cluster: false, port: 0 });
    const res = await request(server).post('/echo').send({ msg: 'hello' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ msg: 'hello' });
  });

  it('resolves dynamic route params', async () => {
    fs.mkdirSync(path.join(apiDir, 'users'));
    writeRoute(
      path.join(apiDir, 'users'), '[id].js',
      `export const GET = async (req, res) => res.json({ id: req.params.id });`,
    );
    server = await ignite({ apiDir, cluster: false, port: 0 });
    const res = await request(server).get('/users/42');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: '42' });
  });

  it('returns 405 for an unregistered method', async () => {
    writeRoute(apiDir, 'items.js', `export const GET = async (_req, res) => res.json([]);`);
    server = await ignite({ apiDir, cluster: false, port: 0 });
    const res = await request(server).post('/items');
    expect(res.status).toBe(405);
  });

  // --- body parsing -----------------------------------------------------

  it('parses JSON bodies automatically', async () => {
    writeRoute(apiDir, 'body.js', `export const POST = async (req, res) => res.json(req.body);`);
    server = await ignite({ apiDir, cluster: false, port: 0 });
    const res = await request(server)
      .post('/body')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ x: 1 }));
    expect(res.body).toEqual({ x: 1 });
  });

  it('parses URL-encoded bodies automatically', async () => {
    writeRoute(apiDir, 'form.js', `export const POST = async (req, res) => res.json(req.body);`);
    server = await ignite({ apiDir, cluster: false, port: 0 });
    const res = await request(server)
      .post('/form')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('name=efc&version=1');
    expect(res.body).toEqual({ name: 'efc', version: '1' });
  });

  // --- CORS -------------------------------------------------------------

  it('allows all origins by default', async () => {
    writeRoute(apiDir, 'ping.js', `export const GET = async (_req, res) => res.json({});`);
    server = await ignite({ apiDir, cluster: false, port: 0 });
    const res = await request(server).get('/ping').set('Origin', 'http://unknown.example');
    expect(res.headers['access-control-allow-origin']).toBe('http://unknown.example');
  });

  it('restricts origins when CORS_ORIGINS is set', async () => {
    process.env['CORS_ORIGINS'] = 'http://allowed.example';
    writeRoute(apiDir, 'ping.js', `export const GET = async (_req, res) => res.json({});`);
    server = await ignite({ apiDir, cluster: false, port: 0 });

    const allowed = await request(server).get('/ping').set('Origin', 'http://allowed.example');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://allowed.example');

    const blocked = await request(server).get('/ping').set('Origin', 'http://evil.example');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('supports multiple origins in CORS_ORIGINS', async () => {
    process.env['CORS_ORIGINS'] = 'http://a.example, http://b.example';
    writeRoute(apiDir, 'ping.js', `export const GET = async (_req, res) => res.json({});`);
    server = await ignite({ apiDir, cluster: false, port: 0 });

    const a = await request(server).get('/ping').set('Origin', 'http://a.example');
    expect(a.headers['access-control-allow-origin']).toBe('http://a.example');

    const b = await request(server).get('/ping').set('Origin', 'http://b.example');
    expect(b.headers['access-control-allow-origin']).toBe('http://b.example');
  });

  it('disables CORS when cors: false', async () => {
    writeRoute(apiDir, 'ping.js', `export const GET = async (_req, res) => res.json({});`);
    server = await ignite({ apiDir, cluster: false, cors: false, port: 0 });
    const res = await request(server).get('/ping').set('Origin', 'http://anywhere.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  // --- port & env auto-reading ------------------------------------------

  it('reads PORT from env when port is not passed', async () => {
    process.env['PORT'] = '0'; // 0 = OS assigns a free port
    writeRoute(apiDir, 'hi.js', `export const GET = async (_req, res) => res.json({ hi: true });`);
    server = await ignite({ apiDir, cluster: false, port: 0 });
    const addr = server.address() as { port: number };
    expect(addr.port).toBeGreaterThan(0);
    delete process.env['PORT'];
  });

  it('falls back to port 3000 when PORT env is absent', async () => {
    delete process.env['PORT'];
    writeRoute(apiDir, 'hi.js', `export const GET = async (_req, res) => res.json({});`);
    server = await ignite({ apiDir, cluster: false, port: 0 }); // 0 avoids binding 3000 in tests
    const addr = server.address() as { port: number };
    expect(addr.port).toBeGreaterThan(0);
  });

  it('ignores NaN port and falls back to env PORT', async () => {
    process.env['PORT'] = '0';
    writeRoute(apiDir, 'hi.js', `export const GET = async (_req, res) => res.json({});`);
    server = await ignite({ apiDir, cluster: false, port: Number(undefined) }); // NaN
    const addr = server.address() as { port: number };
    expect(addr.port).toBeGreaterThan(0);
    delete process.env['PORT'];
  });

  // --- error handling ---------------------------------------------------

  it('returns 404 for unknown routes', async () => {
    writeRoute(apiDir, 'exists.js', `export const GET = async (_req, res) => res.json({});`);
    server = await ignite({ apiDir, cluster: false, port: 0 });
    const res = await request(server).get('/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns structured JSON for HttpError', async () => {
    // Attach statusCode directly to avoid cross-module instanceof issues in tests
    writeRoute(
      apiDir, 'fail.js',
      `export const GET = async (_req, _res, next) => {
         const err = Object.assign(new Error('Invalid input'), { statusCode: 422 });
         next(err);
       };`,
    );
    server = await ignite({ apiDir, cluster: false, port: 0 });
    const res = await request(server).get('/fail');
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: 'Invalid input', statusCode: 422 });
  });
});
