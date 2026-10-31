import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import type { AuthStrategy, EFCConfig } from './types.js';
import { configureAuth } from './auth/index.js';
import { configureLogger } from './logger.js';
import { createHttpApp, mountErrorHandler } from './http-app.js';
import { scanDir } from './router/scan.js';
import { mountRoutes } from './router/mount.js';
import { mountOpenAPI } from './openapi.js';

export interface TestAppOptions {
  openapi?: EFCConfig['openapi'];
  /** Explicit fixtures/app API directory. Does not change cwd or ignite() conventions. */
  apiDir: string;
  basePath?: string;
  globalMiddlewares?: express.RequestHandler[];
  requestTimeout?: number;
  trustProxy?: EFCConfig['trustProxy'];
  onError?: express.ErrorRequestHandler;
  /** Auth is process-wide, as in ignite(); use one configuration per test process. */
  auth?: {
    secret: string;
    strategy?: AuthStrategy;
    expiresIn?: string;
    cookieDomain?: string;
  };
}

/**
 * Mounts real file-based routes on an Express app for supertest (or another HTTP
 * harness). Does not listen, fork workers, start services, or install signal handlers.
 * Models and task queues need separately configured integration fixtures.
 */
export async function createTestApp(options: TestAppOptions): Promise<express.Express> {
  if (typeof options.apiDir !== 'string' || !options.apiDir.trim()) {
    throw new Error('[EFC] createTestApp requires a nonempty apiDir');
  }
  const apiDir = path.resolve(options.apiDir);
  if (!fs.existsSync(apiDir) || !fs.statSync(apiDir).isDirectory()) {
    throw new Error(`[EFC] createTestApp apiDir is not a directory: ${apiDir}`);
  }
  configureLogger(false);
  if (options.auth) {
    configureAuth({
      secret: options.auth.secret,
      strategy: options.auth.strategy ?? 'http-only',
      expiresIn: options.auth.expiresIn ?? '1h',
      ...(options.auth.cookieDomain !== undefined && { cookieDomain: options.auth.cookieDomain }),
    });
  }
  const app = createHttpApp({
    cors: false,
    ...(options.globalMiddlewares !== undefined && {
      globalMiddlewares: options.globalMiddlewares,
    }),
    ...(options.requestTimeout !== undefined && { requestTimeout: options.requestTimeout }),
    ...(options.trustProxy !== undefined && { trustProxy: options.trustProxy }),
  });
  const router = express.Router();
  const mounted = await mountRoutes(router, scanDir(apiDir));
  if (options.openapi)
    await mountOpenAPI(app, mounted, {
      ...(options.openapi === true ? {} : options.openapi),
      basePath: options.basePath ?? '/v1/api',
    });
  app.use(options.basePath ?? '/v1/api', router);
  mountErrorHandler(app, options.onError);
  return app;
}
