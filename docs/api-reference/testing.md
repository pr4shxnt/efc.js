# `createTestApp(options)`

```ts
import { createTestApp } from 'express-file-cluster/testing';
import type { TestAppOptions } from 'express-file-cluster/testing';
```

Returns `Promise<express.Express>` with real file-based routes mounted, without starting a listener or booting services.

| Option | Default | Behavior |
|---|---|---|
| `apiDir: string` | required | Absolute path, or path resolved against the current working directory; rejects a nonexistent/non-directory path. |
| `basePath?: string` | `/v1/api` | Mount point for the API router. |
| `globalMiddlewares?: RequestHandler[]` | `[]` | Runs after body/cookie parsing and before file middleware/validation. |
| `auth?: { secret; strategy?; expiresIn?; cookieDomain? }` | unchanged | Configures process-wide auth; strategy defaults to `http-only`, expiry to `1h`. |
| `requestTimeout?: number` | disabled | Production request timeout in milliseconds; responds 408. |
| `trustProxy?` | Express default | Same value type as `EFCConfig.trustProxy`; supports client-IP tests behind a proxy. |
| `onError?: ErrorRequestHandler` | production error handler | Express error middleware mounted after the API. |

Shared behavior with production: JSON/form/cookie parsing, AsyncLocalStorage request context, request IDs, bigint JSON serialization, route scanning/order, file middleware, schema validation, method dispatch, and safe error responses. CORS, logging, the dashboard and service initialization are disabled/omitted. Auth/logging and imported modules retain process-wide state; see [test isolation](../guides/testing.md).

This helper's `apiDir` is **not** a new `ignite()` option. `createTestApp` is exported only from `/testing`; no `/db`, `/router` or `/middleware` subpaths are added.

The CommonJS `/testing` entry delegates to the ESM helper using native `import()`, so dynamically imported ESM routes share its authentication and request context. The Node/runner must support the route files' module format.
