# Logging & Request IDs

EFC logs through [pino](https://getpino.io): structured JSON in production, readable one-line output in a development terminal. Every request gets an ID that follows it through every log line.

---

## Configuration

```ts
ignite({
  ...config,
  logging: {
    level: 'info',      // trace | debug | info | warn | error | fatal | silent
    pretty: undefined,  // default: true in a non-production TTY, JSON otherwise
    requests: true,     // one line per completed request
    queries: false,     // model operation logging — see "Query logging" below
  },
});
```

`logging: false` silences framework logs entirely (request IDs are still assigned).

---

## Request IDs

Each request gets an ID — a well-formed incoming `X-Request-Id` header (e.g. from your load balancer: letters, digits, `.`, `:`, `-`, `_`, up to 128 chars) or a fresh UUID. It is:

- echoed back in the `X-Request-Id` response header,
- available as `req.id`,
- bound to a child logger, `req.log`, and to `getLogger()` anywhere in the request's async chain — models, helpers, anything awaited from the handler.

```ts
import { getLogger } from 'express-file-cluster';

export async function chargeCard(orderId: string) {
  getLogger().info({ orderId }, 'charging card'); // carries the current request's reqId
}
```

Outside a request (startup, task handlers, timers) `getLogger()` returns the root logger. `logger` is a convenience proxy for `getLogger()`.

---

## Request lines

With `requests: true`, every completed request logs method, URL, status and duration — at `info` for < 400, `warn` for 4xx, `error` for 5xx:

```
12:00:01 INFO  [w2] 3f9c2a1b GET /v1/api/users 200 method=GET url=/v1/api/users status=200 durationMs=3.4
```

In production the same record is JSON:

```json
{"level":30,"time":"2026-10-10T12:00:01.123Z","worker":"w2","reqId":"3f9c2a1b-…","method":"GET","url":"/v1/api/users","status":200,"durationMs":3.4,"msg":"GET /v1/api/users 200"}
```

`worker` is `primary` or `w<N>` for cluster worker N, so interleaved output from many workers stays attributable.

---

## Query logging

`logging.queries` reports model operations — every `defineModel` and `defineTable` call — with the model, operation, duration, how many database statements it issued, and the request ID:

```ts
logging: { queries: true }                                   // every operation, plus slow-query warnings
logging: { queries: { slowMs: 200 } }                        // only operations taking ≥ 200 ms (production)
logging: { queries: { all: true, slowMs: 200, nPlusOne: 5 } }
```

| Option | Default | |
|---|---|---|
| `all` | `true` with `queries: true`, else `false` | log every operation at `info` |
| `slowMs` | `500` | operations at least this slow log at `warn` with `slow=true` |
| `nPlusOne` | `10` | warn when one request runs the same `Model.operation` this many times; `false` disables |

```
12:00:01 INFO  [w2] 3f9c2a1b Post.findMany 2.1ms model=Post op=findMany durationMs=2.1 statements=1
12:00:01 WARN  [w2] 3f9c2a1b Slow query: Order.aggregate 812.4ms model=Order op=aggregate durationMs=812.4 statements=1 slow=true
```

`statements` counts the SQL statements (PostgreSQL) or MongoDB commands the call sent, including nested work such as `populate`; first-use auto-sync is not counted. An operation that throws is still logged, with `error`.

### N+1 detection

Querying inside a loop is the classic N+1 problem. When one request runs the same model operation `nPlusOne` times, EFC warns once for that request, naming the line that made the call:

```
12:00:01 WARN  [w2] 3f9c2a1b Possible N+1: User.findById ran 10 times in one request — load them in one query instead model=User op=findById count=10 site=GET (/app/src/api/posts.ts:14:30)
```

Load them together instead — `User.find({ id: { $in: ids } })`, `populate`, or `findMany({ where: { id: { in: ids } } })`. Only top-level calls count (not `populate`'s), and only inside a request.

On MongoDB, query logging takes mongoose's `debug` hook (`mongoose.set('debug', …)`) to count commands, so it replaces any `debug` setting of your own while it is on.

---

## Errors

Unhandled errors are logged at `error` with the request ID and full stack (`err`) before the 500 response is sent. Task failures log the task name, job ID and attempt number.

---

## Shipping logs

JSON lines on stdout is what log collectors (Datadog, Loki, CloudWatch, Vector) expect — no transport configuration needed. For custom pino transports, set `pretty: false` and pipe stdout.

## Query metrics

Opt in with `logging: { queries: { metrics: true } }`, or `{ metrics: { maxEntries: 500 } }`. The default limit when enabled is 1000 distinct model/operation pairs per worker process; zero disables metrics. Logging and slow/N+1 options remain independent.

```ts
import { getQueryMetrics, resetQueryMetrics } from 'express-file-cluster';

const snapshot = getQueryMetrics();
// { enabled, since, dropped, entries: [{ model, op, calls, errors, statements,
//   totalMs, minMs, maxMs, meanMs, slow }] }
resetQueryMetrics(); // optional: start a fresh window without disabling collection
```

Snapshots are detached from internal state and contain no SQL, parameter values, error details or request IDs. Each entry aggregates completed calls, failures, inclusive statement counts and durations in milliseconds. Nested model calls retain their own entries; their statements also count toward the outer operation, so summing entries is not a global database statement total. `slow` counts calls at or above `slowMs`.

When the entry limit is reached, existing pairs keep updating; observations for new pairs increment `dropped`. Reset/reconfiguration clears entries, dropped counts and the `since` timestamp. Metrics are off by default. These are per-process counters, not a cluster-wide service or an OpenTelemetry exporter; collect from each worker/instance separately and secure any diagnostic endpoint you add.

Since 0.12.0: opt-in OpenTelemetry instrumentation uses `tracing: true | TracingOptions`; the app owns its SDK and exporter. See [tracing](../guides/tracing.md) for HTTP/task propagation, trace log fields, thread behavior and shutdown ownership.
