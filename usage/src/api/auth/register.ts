import type { Request, Response } from 'express';
import { User } from '../../models/user.model.js';
import { issueToken } from 'express-file-cluster/auth';

export const POST = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // 1. Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  // 2. Hash password
  // ⚠️ NOTE: In a real app, use bcrypt or argon2! (e.g., await bcrypt.hash(password, 10))
  const hashedPassword = password;

  // 3. Create user using EFC's ModelCRUD
  const newUser = await User.create({ email, password: hashedPassword });

  // 4. Issue a JWT cookie automatically using EFC's auth helper
  await issueToken(res, { userId: newUser.id, email: newUser.email });

  res.status(201).json({
    message: 'User registered successfully',
    id: newUser.id,
  });
};
