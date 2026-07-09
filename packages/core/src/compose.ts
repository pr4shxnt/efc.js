import type { RequestHandler } from 'express';

/**
 * Chains multiple Express request handlers into a single handler.
 * Each handler calls the next one via its `next` callback.
 *
 * @example
 * export const GET = compose(requireAuth, rateLimiter, myHandler);
 */
export function compose(...handlers: RequestHandler[]): RequestHandler {
  return (req, res, next) => {
    function dispatch(i: number): void {
      if (i >= handlers.length) {
        next();
        return;
      }
      const handler = handlers[i];
      if (!handler) {
        next();
        return;
      }
      try {
        Promise.resolve(handler(req, res, () => dispatch(i + 1))).catch(next);
      } catch (err) {
        next(err);
      }
    }

    dispatch(0);
  };
}
