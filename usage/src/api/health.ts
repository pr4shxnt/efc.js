import type { Request, Response } from 'express';

export const meta = {
  description: 'Health check endpoint. Returns server status and current timestamp to confirm the API is reachable.',
  request: {
    params: {},
  },
  response: {
    status: 200,
    body: { status: 'OK', timestamp: '2026-06-25T10:30:00.000Z' },
  },
};

export const GET = async (_req: Request, res: Response) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
};
