import type { IRouter, RequestHandler } from 'express';
import type { MountedRoute, RouteMeta, RouteEntry } from '../types.js';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

function asyncWrap(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export async function mountRoutes(
  app: IRouter,
  routes: RouteEntry[],
): Promise<MountedRoute[]> {
  const mounted: MountedRoute[] = [];

  for (const route of routes) {
    const mod = (await import(route.filePath)) as Record<string, unknown>;
    const routeMiddlewares: RequestHandler[] = Array.isArray(mod['middlewares'])
      ? (mod['middlewares'] as RequestHandler[])
      : [];

    const raw = mod['meta'];
    const meta: RouteMeta | undefined =
      raw != null && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as RouteMeta)
        : undefined;

    const implemented: HttpMethod[] = [];
    const unimplemented: HttpMethod[] = [];

    for (const method of HTTP_METHODS) {
      if (typeof mod[method] === 'function') {
        implemented.push(method);
        app[method.toLowerCase() as Lowercase<HttpMethod>](
          route.urlPath,
          ...routeMiddlewares,
          asyncWrap(mod[method] as RequestHandler),
        );
      } else {
        unimplemented.push(method);
      }
    }

    if (implemented.length > 0 && unimplemented.length > 0) {
      const allowHeader = implemented.join(', ');
      app.all(route.urlPath, (req, res, next) => {
        if ((unimplemented as string[]).includes(req.method)) {
          res.set('Allow', allowHeader).status(405).json({ error: 'Method Not Allowed' });
        } else {
          next();
        }
      });
    }

    mounted.push({ ...route, methods: implemented, meta });
  }

  return mounted;
}

export { asyncWrap };
