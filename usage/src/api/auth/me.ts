import type { Request, Response } from 'express';
import { requireAuth } from 'express-file-cluster/auth';
import { User } from '../../models/user.model.js';

// Define standard Express middlewares as an array (EFC supports this!)
export const middlewares = [requireAuth];

export const GET = async (req: Request, res: Response) => {
  // `requireAuth` populates req.user from the JWT token
  const { userId } = (req as any).user;

  // Fetch the user from the database
  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Never send the password back!
  const { password, ...safeUser } = user;
  
  res.json({ user: safeUser });
};
