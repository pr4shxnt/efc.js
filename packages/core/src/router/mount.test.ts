import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mountRoutes } from './mount.js';
import type { RouteEntry } from '../types.js';

function makeApp() {
  return express();
}

describe('mountRoutes', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-mount-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('mounts a GET handler from a route module', async () => {
    const file = path.join(tmpDir, 'health.js');
    fs.writeFileSync(
      file,
      `export const GET = async (req, res) => res.json({ ok: true });`,
    );

    const app = makeApp();
    const routes: RouteEntry[] = [{ urlPath: '/health', filePath: file, params: [] }];

    await mountRoutes(app, routes);

    const stack = app._router?.stack ?? [];
    const hasRoute = stack.some(
      (layer: { route?: { path: string; methods: Record<string, boolean> } }) =>
        layer.route?.path === '/health' && layer.route?.methods?.get,
    );
    expect(hasRoute).toBe(true);
  });

  it('mounts multiple methods from a single route file', async () => {
    const file = path.join(tmpDir, 'users.js');
    fs.writeFileSync(
      file,
      `export const GET = async (req, res) => res.json([]);
       export const POST = async (req, res) => res.status(201).json({});`,
    );

    const app = makeApp();
    const routes: RouteEntry[] = [{ urlPath: '/users', filePath: file, params: [] }];

    await mountRoutes(app, routes);

    // Express registers one layer per method; collect all /users layers
    type Layer = { route?: { path: string; methods: Record<string, boolean> } };
    const stack: Layer[] = app._router?.stack ?? [];
    const layers = stack.filter((l) => l.route?.path === '/users');
    const methods = layers.flatMap((l) => Object.keys(l.route?.methods ?? {}));
    expect(methods).toContain('get');
    expect(methods).toContain('post');
  });

  it('skips non-function exports silently', async () => {
    const file = path.join(tmpDir, 'noop.js');
    fs.writeFileSync(file, `export const middlewares = [];`);

    const app = makeApp();
    const routes: RouteEntry[] = [{ urlPath: '/noop', filePath: file, params: [] }];

    await expect(mountRoutes(app, routes)).resolves.toBeUndefined();
  });
});
