import { describe, it, expect } from 'vitest';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import request from 'supertest';
import { compose } from '../compose.js';

describe('compose', () => {
  it.each(['callback', 'throw', 'reject'] as const)(
    'forwards a %s error without running the handler',
    async (mode) => {
      const app = express();
      let reached = false;
      app.get(
        '/',
        compose(
          (_req, _res, next) => {
            const error = new Error('denied');
            if (mode === 'throw') throw error;
            if (mode === 'reject') return Promise.reject(error);
            next(error);
          },
          (_req, res) => {
            reached = true;
            res.send('protected');
          },
        ),
      );
      const onError: ErrorRequestHandler = (err, _req, res, _next) =>
        res.status(403).json({ error: err.message });
      app.use(onError);
      const res = await request(app).get('/');
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'denied' });
      expect(reached).toBe(false);
    },
  );

  it('preserves next(), next(null), and Express route skipping', async () => {
    const app = express();
    const seen: string[] = [];
    app.get(
      '/',
      compose(
        (_req, _res, next) => {
          seen.push('first');
          next();
        },
        (_req, _res, next) => {
          seen.push('second');
          next(null);
        },
        (_req, _res, next) => {
          seen.push('third');
          next('route');
        },
        (_req, res) => res.status(500).end(),
      ),
    );
    app.get('/', (_req, res) => res.json(seen));
    expect((await request(app).get('/')).body).toEqual(['first', 'second', 'third']);
  });
});
