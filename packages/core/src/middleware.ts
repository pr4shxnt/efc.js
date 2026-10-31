import type { RequestHandler, ErrorRequestHandler } from 'express';

/** Express 4 does not observe returned promises. Keep its next/skip semantics. */
export function asyncWrap(handler: RequestHandler): RequestHandler {
  if (typeof handler !== 'function') throw new TypeError('[EFC] Middleware must be a function');
  return (req, res, next) => {
    try {
      void Promise.resolve(handler(req, res, next)).catch(next);
    } catch (error) {
      next(error);
    }
  };
}
export function asyncErrorWrap(handler: ErrorRequestHandler): ErrorRequestHandler {
  return (error, req, res, next) => {
    try {
      void Promise.resolve(handler(error, req, res, next)).catch(next);
    } catch (failure) {
      next(failure);
    }
  };
}
