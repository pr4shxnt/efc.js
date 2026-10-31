import { it, expect, vi } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
vi.mock('../../cache/index.js', () => ({
  isCacheConfigured: () => true,
  rawGet: async () => {
    await new Promise((r) => setTimeout(r, 30));
    return '1';
  },
  revocationFailureMode: () => 'reject',
}));
import { requireAuth, signToken } from '../../auth/index.js';
import { createTestApp } from '../../testing.js';
it('does not write a second auth response or run protected handlers after a request timeout', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-auth-timeout-'));
  fs.writeFileSync(
    path.join(dir, 'test.mjs'),
    'export const GET=(_req,res)=>res.json({protected:true});',
  );
  try {
    let reached = false;
    const app = await createTestApp({
      apiDir: dir,
      auth: { secret: 'timeout-secret', strategy: 'bearer' },
      requestTimeout: 5,
      globalMiddlewares: [
        requireAuth,
        (_req, _res, next) => {
          reached = true;
          next();
        },
      ],
    });
    const token = await signToken({ id: 'one' });
    const res = await request(app).get('/v1/api/test').auth(token, { type: 'bearer' });
    expect(res.status).toBe(408);
    await new Promise((r) => setTimeout(r, 60));
    expect(reached).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
