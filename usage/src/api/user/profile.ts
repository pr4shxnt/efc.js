import { requireAuth } from 'express-file-cluster/auth';
import type { Request, Response } from 'express';
import type { RouteMeta } from 'express-file-cluster';

export const meta: RouteMeta = {
  description: "Fetch the authenticated user's profile. Requires a valid JWT.",
  response: { status: 200, body: { message: 'User Profile Panel', user: { id: '1', role: 'user', email: 'user@example.com' } } },
};

export const middlewares = [requireAuth];

export const GET = async (req: Request, res: Response) => {
  const user = (req as any).user;
  
  res.json({
    message: 'User Profile Panel',
    user
  });
};
