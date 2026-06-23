import type { Request, Response } from 'express';

export const GET = async (_req: Request, res: Response) => {
  res.json({ status: 'I am knowledgeable', timestamp: new Date().toISOString() });
};
