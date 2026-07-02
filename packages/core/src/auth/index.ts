import type { NextFunction, Request, RequestHandler, Response } from 'express';
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

async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
  roles: string[],
): Promise<void> {
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

    if (roles.length > 0) {
      const role = (payload as Record<string, unknown>)['role'];
      if (typeof role !== 'string' || !roles.includes(role)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
    }

    (req as typeof req & { user: unknown }).user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

/**
 * Used bare (`middlewares = [requireAuth]`) it just verifies the JWT.
 * Called with role names (`middlewares = [requireAuth('admin')]`) it
 * returns a middleware that also enforces `payload.role` is one of them.
 */
export interface RequireAuth {
  (req: Request, res: Response, next: NextFunction): void;
  (...roles: string[]): RequestHandler;
}

export const requireAuth: RequireAuth = ((...args: unknown[]) => {
  if (args.length > 0 && typeof args[0] === 'string') {
    const roles = args as string[];
    return (req: Request, res: Response, next: NextFunction) => {
      void authenticate(req, res, next, roles);
    };
  }
  const [req, res, next] = args as [Request, Response, NextFunction];
  void authenticate(req, res, next, []);
}) as RequireAuth;
