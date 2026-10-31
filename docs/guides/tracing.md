# OpenTelemetry tracing (unreleased)

EFC can trace incoming HTTP requests and background work across BullMQ, pg-boss and worker-thread handoffs. Enable `ignite({ tracing: true })`, or select components with `tracing: { http: true, tasks: true }`. Instrumentation is off by default and is not included in published 0.11.0.

Your application owns the OpenTelemetry SDK, sampling, resources and exporter. EFC uses the standard API and W3C trace-context propagator; it does not create a global provider, read OTLP environment variables, install auto-instrumentation, or choose a collector. Without a registered SDK, tracing safely remains no-op.

## Configure the application SDK

This example uses the current unified tracing SDK and its compatible API line:

```bash
npm install @opentelemetry/api@~1.9.0 @opentelemetry/sdk-trace@^2.12.0 @opentelemetry/context-async-hooks@^2.12.0
```

```ts
// src/index.ts — initialize before ignite(), in each serving process
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { TracerProvider, BatchSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace';
import { ignite, gracefulShutdown } from 'express-file-cluster';
import config from '../efc.config.js';

const manager = new AsyncLocalStorageContextManager().enable();
const provider = new TracerProvider({
  spanProcessors: [new BatchSpanProcessor({ exporter: new ConsoleSpanExporter() })],
});
context.setGlobalContextManager(manager);
trace.setGlobalTracerProvider(provider);

const server = await ignite({
  ...config,
  tracing: {
    shutdown: async () => {
      await provider.shutdown();
      manager.disable();
    },
  },
});
gracefulShutdown(server);
```

Use your preferred exporter in place of `ConsoleSpanExporter`; EFC does not send data to a collector on its own. Initialize an SDK/context manager in every cluster worker; SDKs and exporters are process-local. Use the API version supported by your chosen SDK. If you already use HTTP/Express auto-instrumentation, set `tracing: { http: false }` to avoid an extra EFC HTTP server span while retaining task tracing.

## HTTP and logs

Each request gets a server span. W3C `traceparent`/`tracestate` headers establish remote parentage; malformed parents start a fresh trace. Concurrent requests retain separate context across awaits. Names use the method and route template (for example `GET /v1/api/users/:id`), with method, template and response status attributes. Unmatched routes use the method alone. Spans end once on response completion or disconnect, including validation failures, request timeouts and WebSocket upgrade handshakes. Upgrades finish at 101; message frames do not create spans automatically.

Server errors and aborted connections mark the span as an error; ordinary 4xx responses do not. The error observer runs before custom error middleware. `req.log`, `getLogger()` and the logger proxy include `trace_id`/`span_id` when a valid span context is active. Task handlers start a fresh EFC request/auth scope, so `$currentUser` and request IDs do not leak from the request that queued them.

EFC HTTP attributes omit raw URLs, query strings, bodies, cookies and credentials. Native queue instrumentation includes job IDs, queue/task names, attempts and failure diagnostics, not application payloads. Exception messages/stacks can contain application data; configure exporter-side redaction for your application's errors. Baggage is not accepted or persisted by EFC's W3C propagation path.

## Queues, retries and threads

The new minimum optional backend versions are **BullMQ 5.79.1** and **pg-boss 12.38.0**; upgrade these peers before using this development build. Native backend metadata persists W3C context separately from application payloads. Existing jobs without trace metadata and scheduled jobs start independent traces. Each retry has its own consumer span under the producer context. Queue/admin payloads and dead-letter retry behavior remain unchanged.

A `thread: true` job's consumer span covers the entire thread execution. W3C context crosses the worker boundary and returns with nested `enqueue()` calls, including mixed ESM/CommonJS route and task modules. The task registry and enqueue implementation are shared between package formats within each isolate. The application SDK is not copied into a worker isolate: instrumenting additional operations inside the thread requires initializing an SDK there. Task-level spans still export from the queue worker's SDK.

## Shutdown and tests

`tracing.shutdown` is optional and app-owned. With `gracefulShutdown(server)`, EFC drains HTTP/WebSockets and task backends before awaiting it, under the existing shutdown deadline. It runs once per serving process; rejection is logged and exits with status 1. Custom spans created in the cluster primary need application-managed SDK shutdown. With a custom lifecycle, close the HTTP server and task backends, then shut down your SDK yourself.

`createTestApp({ apiDir, tracing: true })` uses the same HTTP instrumentation without creating an SDK or listener. It does not own SDK shutdown. Tests can register an in-memory exporter and inspect actual finished spans. Global OpenTelemetry SDK/context-manager state is process-wide; isolate tests or reset that state between configurations.

See [the API reference](../api-reference/tracing.md), [OpenTelemetry instrumentation](https://opentelemetry.io/docs/languages/js/instrumentation/), [BullMQ telemetry](https://docs.bullmq.io/guide/telemetry/) and [pg-boss tracing](https://pgboss.io/opentelemetry).
