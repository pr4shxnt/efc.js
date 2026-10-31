# Tracing API (unreleased)

```ts
import type { TracingOptions, EFCConfig } from 'express-file-cluster';

interface TracingOptions {
  http?: boolean;
  tasks?: boolean;
  shutdown?: () => Promise<void>;
}
// EFCConfig.tracing?: boolean | TracingOptions
```

Disabled by default. `true` enables HTTP and task instrumentation. An options object enables both unless its `http` or `tasks` field is false. `shutdown` is an optional app SDK shutdown/flush callback, awaited once after serving-process HTTP/WebSocket/task drain by `gracefulShutdown`, within its timeout. Callback rejection logs an error and exits with status 1. A helper/custom server does not invoke it automatically.

The app must register its OpenTelemetry provider and async context manager before boot. EFC owns no SDK/exporter and does not change global providers. No new subpath, span helper or OTLP config is exported. The application uses `@opentelemetry/api` for its own spans.

`TestAppOptions.tracing` accepts the same option for HTTP instrumentation; task backends are not booted by the helper. See the [guide](../guides/tracing.md) for setup, privacy, backend minimums, worker-thread behavior and SDK lifecycle.
