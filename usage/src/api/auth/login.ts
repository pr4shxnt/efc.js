import { issueToken } from 'express-file-cluster/auth';
import type { Request, Response } from 'express';
import type { RouteMeta } from 'express-file-cluster';

export const meta: RouteMeta = {
  description: 'Authenticate a user and issue a JWT via http-only cookie.',
  request: { body: { email: 'user@example.com', password: 'user' } },
  response: { status: 200, body: { message: 'Logged in as user' } },
};

export const POST = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  
  if (email === 'admin@example.com' && password === 'admin') {
    await issueToken(res, { id: '1', role: 'admin', email });
    return res.json({ message: 'Logged in as admin' });
  }
  
  if (email === 'user@example.com' && password === 'user') {
    await issueToken(res, { id: '2', role: 'user', email });
    return res.json({ message: 'Logged in as user' });
  }
  
  res.status(401).json({ error: 'Invalid credentials' });
};
