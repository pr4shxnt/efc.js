import { beforeEach, afterEach, it, expect } from 'vitest';
import {
  context,
  trace,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
} from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  TracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createTestApp } from '../testing.js';
import {
  bullMQTelemetry,
  injectTrace,
  extractTrace,
  configureTracing,
  shutdownTracing,
  taskContext,
  tracePropagator,
} from '../tracing.js';
import { runWithContext, getCurrentUser } from '../context.js';
import { getLogger } from '../logger.js';

let provider: TracerProvider;
let exporter: InMemorySpanExporter;
let manager: AsyncLocalStorageContextManager;
const dirs: string[] = [];
beforeEach(() => {
  trace.disable();
  context.disable();
  propagation.disable();
  exporter = new InMemorySpanExporter();
  provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });
  manager = new AsyncLocalStorageContextManager().enable();
  context.setGlobalContextManager(manager);
  trace.setGlobalTracerProvider(provider);
});
afterEach(async () => {
  await provider.shutdown();
  manager.disable();
  trace.disable();
  context.disable();
  propagation.disable();
  configureTracing(false);
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function fixtures(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-tracing-'));
  dirs.push(dir);
  for (const [name, source] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  }
  return dir;
}
const api = JSON.stringify(createRequire(import.meta.url).resolve('@opentelemetry/api'));
it('continues remote traces, isolates concurrent requests and records templates without URL/query/credential values', async () => {
  const dir = fixtures({
    'users/[id].mjs': `import {trace} from ${api};export const GET=async(req,res)=>{await new Promise(r=>setTimeout(r,5));res.json({span:trace.getActiveSpan()?.spanContext(),log:req.log.bindings()});};`,
  });
  const app = await createTestApp({ apiDir: dir, tracing: true });
  const responses = await Promise.all(
    ['1', '2'].map((id) =>
      request(app)
        .get('/v1/api/users/' + id + '?secret=hidden')
        .set('traceparent', `00-${id.repeat(32)}-${'a'.repeat(16)}-01`)
        .set('Authorization', 'Bearer hidden'),
    ),
  );
  await provider.forceFlush();
  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(2);
  for (let i = 0; i < 2; i++) {
    const response = responses[i]!;
    expect(response.status).toBe(200);
    expect(response.body.span.traceId).toBe(String(i + 1).repeat(32));
    expect(response.body.log.trace_id).toBe(response.body.span.traceId);
    const span = spans.find((s) => s.spanContext().traceId === response.body.span.traceId)!;
    expect(span.kind).toBe(SpanKind.SERVER);
    expect(span.name).toBe('GET /v1/api/users/:id');
    expect(span.parentSpanContext?.spanId).toBe('a'.repeat(16));
    expect(span.attributes).toMatchObject({
      'http.route': '/v1/api/users/:id',
      'http.response.status_code': 200,
    });
    expect(JSON.stringify(span.attributes)).not.toContain('hidden');
  }
});
it('ends errors and timeouts once, leaves 4xx unset, and traces errors handled by custom middleware', async () => {
  const dir = fixtures({
    'failure.mjs': 'export const GET=()=>{throw new Error("boom")};',
    'bad.mjs': 'export const GET=(_req,res)=>res.status(400).json({error:"bad"});',
    'stuck.mjs': 'export const middlewares=[()=>{}];export const GET=()=>{};',
  });
  const app = await createTestApp({ apiDir: dir, tracing: true, requestTimeout: 30 });
  for (const [url, status] of [
    ['failure', 500],
    ['bad', 400],
    ['stuck', 408],
    ['missing', 404],
  ] as const)
    expect((await request(app).get('/v1/api/' + url)).status).toBe(status);
  await provider.forceFlush();
  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(4);
  expect(spans.find((s) => s.name.endsWith('/failure'))!.status.code).toBe(SpanStatusCode.ERROR);
  expect(spans.find((s) => s.name.endsWith('/failure'))!.events[0]?.name).toBe('exception');
  expect(spans.find((s) => s.name.endsWith('/bad'))!.status.code).toBe(SpanStatusCode.UNSET);
  const custom = await createTestApp({
    apiDir: dir,
    tracing: true,
    onError: (_err, _req, res, _next) => {
      res.status(503).end();
    },
  });
  expect((await request(custom).get('/v1/api/failure')).status).toBe(503);
  await provider.forceFlush();
  expect(exporter.getFinishedSpans().at(-1)!.status.code).toBe(SpanStatusCode.ERROR);
});
it('is opt-in and safe with no SDK; HTTP can be disabled independently', async () => {
  const dir = fixtures({ 'health.mjs': 'export const GET=(_req,res)=>res.json({ok:true});' });
  for (const tracing of [undefined, false, { http: false }]) {
    const app = await createTestApp({ apiDir: dir, ...(tracing !== undefined && { tracing }) });
    expect((await request(app).get('/v1/api/health')).status).toBe(200);
  }
  expect(exporter.getFinishedSpans()).toHaveLength(0);
  trace.disable();
  const app = await createTestApp({ apiDir: dir, tracing: true });
  expect((await request(app).get('/v1/api/health')).status).toBe(200);
});
it('uses native queue metadata, keeps trace-only carriers, and clears auth/request state for task handlers', async () => {
  const telemetry = bullMQTelemetry();
  const parent = trace.getTracer('test').startSpan('request');
  const parentCtx = trace.setSpan(ROOT_CONTEXT, parent);
  await context.with(parentCtx, async () => {
    const producer = telemetry.tracer.startSpan('add Task', { kind: SpanKind.PRODUCER });
    const metadata = telemetry.contextManager.getMetadata(
      producer.setSpanOnContext(context.active()),
    );
    const parsed = JSON.parse(metadata);
    expect(Object.keys(parsed)).toEqual(['traceparent']);
    const received = telemetry.contextManager.fromMetadata(ROOT_CONTEXT, metadata);
    const consumer = telemetry.tracer.startSpan(
      'process Task',
      { kind: SpanKind.CONSUMER },
      received,
    );
    await telemetry.contextManager.with(consumer.setSpanOnContext(received), async () =>
      runWithContext({ user: { id: 'must-not-leak' }, requestId: 'old' }, async () =>
        taskContext(async () => {
          await Promise.resolve();
          expect(getCurrentUser()).toBeUndefined();
          expect(getLogger().bindings().trace_id).toBe(parent.spanContext().traceId);
          expect(trace.getActiveSpan()?.spanContext().traceId).toBe(parent.spanContext().traceId);
        }),
      ),
    );
    consumer.recordException(new Error('failure'));
    consumer.end();
    producer.end();
  });
  parent.end();
  await provider.forceFlush();
  const spans = exporter.getFinishedSpans();
  const consumer = spans.find((s) => s.name === 'process Task')!;
  expect(consumer.status.code).toBe(SpanStatusCode.ERROR);
  expect(consumer.parentSpanContext?.spanId).toBe(
    spans.find((s) => s.name === 'add Task')!.spanContext().spanId,
  );
  expect(
    trace.getSpanContext(telemetry.contextManager.fromMetadata(ROOT_CONTEXT, 'broken')),
  ).toBeUndefined();
});
it('propagates trace context without a context manager, refuses invalid parents and excludes baggage', () => {
  const carrier = {
    traceparent: `00-${'b'.repeat(32)}-${'c'.repeat(16)}-01`,
    tracestate: 'vendor=value',
    baggage: 'password=hidden',
  };
  context.disable();
  const remote = extractTrace(carrier);
  const output = runWithContext({ otelContext: remote }, () => injectTrace());
  expect(output).toEqual({ traceparent: carrier.traceparent, tracestate: carrier.tracestate });
  expect(trace.getSpanContext(extractTrace({ traceparent: 'invalid' }))).toBeUndefined();
  const dest: Record<string, string> = {};
  tracePropagator.inject(remote, dest, {
    set: (c, k, v) => {
      c[k] = v;
    },
  });
  expect(dest).not.toHaveProperty('baggage');
});
it('calls the app-owned SDK shutdown once, and does not swallow failures', async () => {
  let calls = 0;
  configureTracing({
    shutdown: async () => {
      calls++;
    },
  });
  await Promise.all([shutdownTracing(), shutdownTracing()]);
  expect(calls).toBe(1);
  configureTracing({
    shutdown: async () => {
      throw new Error('exporter failure');
    },
  });
  await expect(shutdownTracing()).rejects.toThrow('exporter failure');
});

it('records aborted HTTP responses without inventing a response status', async () => {
  const dir = fixtures({ 'abort.mjs': 'export const GET=(req,res)=>res.destroy();' });
  const app = await createTestApp({ apiDir: dir, tracing: true });
  await expect(request(app).get('/v1/api/abort')).rejects.toThrow();
  await provider.forceFlush();
  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(1);
  expect(spans[0]!.status.code).toBe(SpanStatusCode.ERROR);
  expect(spans[0]!.attributes['error.type']).toBe('connection_closed');
  expect(spans[0]!.attributes).not.toHaveProperty('http.response.status_code');
});

it('captures the configured SDK shutdown callback before another app reconfigures tracing', async () => {
  const calls: string[] = [];
  configureTracing({
    shutdown: async () => {
      calls.push('first');
    },
  });
  const first = shutdownTracing();
  configureTracing({
    shutdown: async () => {
      calls.push('second');
    },
  });
  await first;
  expect(calls).toEqual(['first']);
  await shutdownTracing();
  expect(calls).toEqual(['first', 'second']);
});
it('treats malformed trace carriers as roots rather than throwing', () => {
  for (const value of [null, undefined, false, 0, 'invalid', [], { traceparent: ['invalid'] }])
    expect(trace.getSpanContext(extractTrace(value))).toBeUndefined();
});
