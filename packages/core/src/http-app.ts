import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import type { EFCConfig } from './types.js';
import { runWithContext } from './context.js';
import { requestLogger, getLogger } from './logger.js';
import { isHttpError } from './errors.js';

/** Shared production/test HTTP middleware stack; service boot remains in ignite(). */
export function createHttpApp(config: EFCConfig): express.Express {
  const globalMiddlewares = config.globalMiddlewares ?? [];
  const app = express();
  if (config.trustProxy !== undefined) app.set('trust proxy', config.trustProxy);
  // defineTable returns `bigint` for bigint columns and bigserial ids, which JSON.stringify
  // rejects; send them as strings (exact — a JS number would lose precision past 2^53).
  app.set('json replacer', (_key: string, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );

  // Wraps every request in its own AsyncLocalStorage context, first thing, so
  // requireAuth (below) and any downstream code — including a `$currentUser`
  // default resolved inside a mongoose `.create()` call — share the same store.
  app.use((_req, _res, next) => {
    runWithContext({}, next);
  });
  app.use(requestLogger());

  if (config.requestTimeout) {
    const ms = config.requestTimeout;
    app.use((_req, res, next) => {
      const timer = setTimeout(() => {
        if (!res.headersSent) res.status(408).json({ error: 'Request Timeout', statusCode: 408 });
      }, ms);
      const clear = () => clearTimeout(timer);
      res.once('finish', clear);
      res.once('close', clear);
      next();
    });
  }

  const corsOption = config.cors ?? true;
  if (corsOption !== false) {
    const origin =
      typeof corsOption === 'object' && corsOption.origin !== undefined ? corsOption.origin : true;
    const corsOpts = typeof corsOption === 'object' ? { ...corsOption, origin } : { origin };
    app.use(cors(corsOpts));
  }

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  for (const mw of globalMiddlewares) {
    app.use(mw);
  }

  return app;
}

export function mountErrorHandler(
  app: express.Express,
  onError?: express.ErrorRequestHandler,
): void {
  if (onError) {
    app.use(onError);
  } else {
    app.use(
      (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        // e.g. a handler that kept going after requestTimeout already answered 408.
        if (res.headersSent) {
          getLogger().warn({ err }, 'Error after the response was sent');
          return;
        }
        // isHttpError() covers the common case, but errors can also arrive as plain
        // objects with a numeric statusCode (e.g. thrown across a module boundary, or
        // duck-typed by user code) — fall back to that shape before giving up to 500.
        // Only 4xx: a library's 5xx message can describe internals (hosts, SQL, paths).
        const status = (err as { statusCode?: unknown } | null)?.statusCode;
        const duckTyped =
          err instanceof Error && typeof status === 'number' && status >= 400 && status < 500
            ? (err as Error & { statusCode: number })
            : null;

        if (isHttpError(err)) {
          // ModelValidationError carries per-field issues; surface them like route validation does.
          const issues = (err as { issues?: unknown }).issues;
          res.status(err.statusCode).json({
            error: err.message,
            statusCode: err.statusCode,
            ...(issues !== undefined && { issues }),
          });
        } else if (duckTyped) {
          res
            .status(duckTyped.statusCode)
            .json({ error: duckTyped.message, statusCode: duckTyped.statusCode });
        } else {
          getLogger().error({ err }, 'Unhandled error');
          res.status(500).json({ error: 'Internal Server Error', statusCode: 500 });
        }
      },
    );
  }
}
