import type { RequestHandler } from 'express';

export function compose(...handlers: RequestHandler[]): RequestHandler {
  return (req, res, next) => {
    let index = 0;

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

    dispatch(index);
  };
}
