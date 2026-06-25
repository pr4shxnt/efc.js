import type { Request, Response } from 'express';

export const meta = {
  request: {
    params: {},
  },
  response: {
    status: 200,
    body: { status: 'I am knowledgeable', timestamp: '2026-06-25T10:30:01.123Z' },
  },
};

export const GET = async (_req: Request, res: Response) => {
  res.json({ status: 'I am knowledgeable', timestamp: new Date().toISOString() });
};
