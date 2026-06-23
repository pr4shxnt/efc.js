import type { Request, Response } from 'express';
import { User } from '../../models/user.model.js';
import { issueToken } from 'express-file-cluster/auth';

export const POST = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // 1. Find user by email
  const user = await User.findOne({ email });
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // 2. Check password
  // ⚠️ NOTE: In a real app, use bcrypt! (e.g., await bcrypt.compare(password, user.password))
  const isMatch = password === user.password; 

  if (!isMatch) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // 3. Issue a JWT cookie automatically using EFC's auth helper
  issueToken(res, { userId: user.id, email: user.email });

  res.json({ message: 'Logged in successfully' });
};
