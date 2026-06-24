import type { RequestHandler, Response } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import type { AuthStrategy } from '../types.js';

interface AuthConfig {
  secret: string;
  strategy: AuthStrategy;
  expiresIn: string;
  cookieDomain?: string | undefined;
}

let _config: AuthConfig | null = null;

export function configureAuth(config: AuthConfig): void {
  _config = config;
}

function getConfig(): AuthConfig {
  if (!_config) throw new Error('[EFC] Auth not configured — pass jwtSecret to ignite()');
  return _config;
}

export async function issueToken(res: Response, payload: Record<string, unknown>): Promise<void> {
  const { secret, expiresIn, cookieDomain } = getConfig();
  const encodedSecret = new TextEncoder().encode(secret);
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(expiresIn)
    .sign(encodedSecret);

  res.cookie('efc_token', token, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'strict',
    ...(cookieDomain !== undefined && { domain: cookieDomain }),
  });
}

export function revokeToken(res: Response): void {
  res.clearCookie('efc_token');
}

export async function signToken(payload: Record<string, unknown>): Promise<string> {
  const { secret, expiresIn } = getConfig();
  const encodedSecret = new TextEncoder().encode(secret);
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(expiresIn)
    .sign(encodedSecret);
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const { secret, strategy } = getConfig();

  try {
    let token: string | undefined;

    if (strategy === 'http-only') {
      const cookies = (req as typeof req & { cookies: Record<string, string> }).cookies;
      token = cookies?.['efc_token'];
    } else {
      const auth = req.headers['authorization'];
      if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        token = auth.slice(7);
      }
    }

    if (!token) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const encodedSecret = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, encodedSecret);
    (req as typeof req & { user: unknown }).user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
};
