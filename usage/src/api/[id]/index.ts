import type { Request, Response } from 'express';

export const GET = async (req: Request, res: Response) => {
  const { id } = req.params;
  res.json({
    status: `I know about ${id}`,
    pid: process.pid,
  });
};
