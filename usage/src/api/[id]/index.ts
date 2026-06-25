import type { Request, Response } from 'express';

export const meta = {
  description: 'Returns a knowledge response for the requested resource ID. The pid field identifies which cluster worker handled the request.',
  request: {
    params: { id: 'quantum-physics' },
  },
  response: {
    status: 200,
    body: { status: 'I know about quantum-physics', pid: 42891 },
  },
};

export const GET = async (req: Request, res: Response) => {
  const { id } = req.params;
  res.json({
    status: `I know about ${id}`,
    pid: process.pid,
  });
};
