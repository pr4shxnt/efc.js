import { requireAuth } from 'express-file-cluster/auth';
import type { Request, Response } from 'express';
import type { RouteMeta } from 'express-file-cluster';

export const meta: RouteMeta = {
  description: 'Admin dashboard stats. Requires authentication with admin role.',
  response: { status: 200, body: { message: 'Welcome to the Admin Panel', stats: { users: 120, revenue: 5000 } } },
};

export const middlewares = [requireAuth];

export const GET = async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (user?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }
  
  res.json({
    message: 'Welcome to the Admin Panel',
    stats: { users: 120, revenue: 5000 }
  });
};
