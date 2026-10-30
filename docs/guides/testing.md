# Testing file-based routes

`createTestApp()` from `express-file-cluster/testing` mounts your real route files on an Express app. Use it with supertest or another HTTP test harness. It shares the production HTTP middleware, router and error handler with `ignite()`, including JSON/form/cookie parsing, request context, validation, catch-all decoding and 405 handling.

```ts
import { createTestApp } from 'express-file-cluster/testing';
import request from 'supertest';
import path from 'node:path';

const app = await createTestApp({
  apiDir: path.resolve('src/api'),
  auth: { secret: 'test-only-secret', strategy: 'bearer' },
});

const response = await request(app).get('/v1/api/health');
expect(response.status).toBe(200);
```

Install the test harness in your app (`npm i -D supertest @types/supertest`). Your test runner must be able to import the route files: Configure the runner/loader to transform dynamically imported TypeScript routes when needed; a plain Node process can point at built JavaScript or use a TypeScript loader.

`apiDir` is required and must be an existing directory. It is specific to this helper; `ignite()` still discovers `src/api` by convention and has no `apiDir` option. Creating multiple apps does not change the working directory. Each app has its own router and middleware stack.

The helper returns an Express app without calling `listen()`, forking workers, scanning tasks, initializing database/cache/queue services, or adding signal handlers. It disables CORS and logging for tests and omits the development dashboard. Supertest can open its own temporary HTTP listener when making a request. For database and queue tests, configure real service fixtures separately, or use `ignite()` to exercise the complete boot lifecycle. The helper does not provide model mocks or an `enqueue()` implementation.

Authentication and logging are process-wide in EFC. The helper disables the process logger and configures auth when `auth` is supplied; use one auth configuration per test process, and isolate suites that require different secrets/strategies. Calling the helper without `auth` does not reset an existing auth configuration. Imported route modules follow normal module caching. Global model/cache/task state is not reset between apps.

See the [API reference](../api-reference/testing.md) for all options.

The CommonJS `/testing` entry delegates to the ESM helper using native `import()`, so dynamically imported ESM routes share its authentication and request context. The Node/runner must support the route files' module format.
