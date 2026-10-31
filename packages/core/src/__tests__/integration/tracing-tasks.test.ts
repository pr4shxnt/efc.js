import { beforeEach, afterEach, it, expect } from 'vitest';
import { context, trace, propagation, SpanKind, SpanStatusCode } from '@opentelemetry/api';
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
import net from 'node:net';
import { createTestApp } from '../../testing.js';
import { registerTask, enqueue, taskRegistry } from '../../tasks/index.js';
import { initBullMQ, closeBullMQ } from '../../tasks/bullmq-backend.js';
import { initPgBoss, closePgBoss } from '../../tasks/pgboss-backend.js';
import { getCurrentUser } from '../../context.js';
import { getLogger } from '../../logger.js';
const redis = process.env['EFC_TEST_REDIS_URL'] ?? 'redis://127.0.0.1:6379/15';
const pg = process.env['EFC_TEST_PG_URL'] ?? 'postgres://postgres@127.0.0.1:5433/efc_test';
async function reachable(url: string) {
  const u = new URL(url);
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: u.hostname, port: Number(u.port), timeout: 1000 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}
const available = { bullmq: await reachable(redis), 'pg-boss': await reachable(pg) };
let provider: TracerProvider;
let exporter: InMemorySpanExporter;
let manager: AsyncLocalStorageContextManager;
const dirs: string[] = [];
let schema: string | undefined;
beforeEach(() => {
  trace.disable();
  context.disable();
  propagation.disable();
  exporter = new InMemorySpanExporter();
  provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });
  manager = new AsyncLocalStorageContextManager().enable();
  context.setGlobalContextManager(manager);
  trace.setGlobalTracerProvider(provider);
  taskRegistry.clear();
});
afterEach(async () => {
  await Promise.all([closeBullMQ(), closePgBoss()]);
  await provider.shutdown();
  manager.disable();
  trace.disable();
  context.disable();
  propagation.disable();
  taskRegistry.clear();
  delete (globalThis as Record<string, unknown>).__efcTraceEnqueue;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  if (schema) {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: pg });
    await client.connect();
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    await client.end();
    schema = undefined;
  }
});
async function waitFor(predicate: () => boolean) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 15000) throw new Error('Timed out waiting for task trace');
    await new Promise((r) => setTimeout(r, 30));
  }
}
for (const backend of ['bullmq', 'pg-boss'] as const) {
  it.skipIf(!available[backend])(
    `propagates HTTP → ${backend} → retry attempts without altering payloads or leaking auth`,
    async () => {
      const name = 'Trace' + Math.random().toString(36).slice(2, 9);
      const queue = 'otel' + Math.random().toString(36).slice(2, 9);
      let attempts = 0;
      const seen: Array<{
        payload: unknown;
        traceId: string | undefined;
        user: unknown;
        log: unknown;
      }> = [];
      const payload = {
        message: 'unchanged user payload',
        items: [1, 2],
        secret: 'not-a-span-attribute',
      };
      registerTask(name, {
        name,
        options: { retries: 1, backoff: 'fixed' },
        handler: async (data) => {
          attempts++;
          seen.push({
            payload: data,
            traceId: trace.getActiveSpan()?.spanContext().traceId,
            user: getCurrentUser(),
            log: getLogger().bindings().trace_id,
          });
          if (attempts === 1) throw new Error('retry once');
        },
      });
      if (backend === 'bullmq')
        await initBullMQ({
          redisUrl: redis,
          queue,
          concurrency: 1,
          enqueueTimeout: 1000,
          tracing: true,
        });
      else {
        schema = 'otel_' + queue;
        await initPgBoss({
          connectionString: pg,
          queue,
          schema,
          concurrency: 1,
          enqueueTimeout: 1000,
          tracing: true,
        });
      }
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-tracing-jobs-'));
      dirs.push(dir);
      fs.writeFileSync(
        path.join(dir, 'queue.mjs'),
        'export const GET=async(_req,res)=>{await globalThis.__efcTraceEnqueue();res.status(202).end();};',
      );
      (globalThis as Record<string, unknown>).__efcTraceEnqueue = () => enqueue(name, payload);
      const app = await createTestApp({ apiDir: dir, tracing: true });
      const parent = 'd'.repeat(32);
      expect(
        (
          await request(app)
            .get('/v1/api/queue')
            .set('traceparent', `00-${parent}-${'e'.repeat(16)}-01`)
        ).status,
      ).toBe(202);
      await waitFor(
        () =>
          exporter
            .getFinishedSpans()
            .filter((s) => s.kind === SpanKind.CONSUMER && s.name.includes(queue)).length >= 2,
      );
      expect(seen).toHaveLength(2);
      for (const item of seen) {
        expect(item.payload).toEqual(payload);
        expect(item.traceId).toBe(parent);
        expect(item.log).toBe(parent);
        expect(item.user).toBeUndefined();
      }
      const consumers = exporter
        .getFinishedSpans()
        .filter((s) => s.kind === SpanKind.CONSUMER && s.name.includes(queue));
      expect(consumers[0]!.status.code).toBe(SpanStatusCode.ERROR);
      expect(consumers.every((s) => s.spanContext().traceId === parent)).toBe(true);
      expect(new Set(consumers.map((s) => s.spanContext().spanId)).size).toBe(2);
      expect(JSON.stringify(consumers.map((s) => s.attributes))).not.toContain(payload.secret);
    },
    25000,
  );
}

it.skipIf(!available.bullmq)(
  'marks stale unregistered BullMQ jobs as failed consumer spans',
  async () => {
    const queueName = 'otelmissing' + Math.random().toString(36).slice(2, 9);
    await initBullMQ({
      redisUrl: redis,
      queue: queueName,
      concurrency: 1,
      enqueueTimeout: 1000,
      tracing: true,
    });
    const { Queue } = await import('bullmq');
    const { parseRedisUrl } = await import('../../tasks/bullmq-backend.js');
    const queue = new Queue(queueName, { connection: parseRedisUrl(redis) });
    try {
      await queue.add('UnknownTask', { value: 'unchanged' }, { attempts: 1 });
      await waitFor(() =>
        exporter
          .getFinishedSpans()
          .some((s) => s.kind === SpanKind.CONSUMER && s.name.includes(queueName)),
      );
      const span = exporter
        .getFinishedSpans()
        .find((s) => s.kind === SpanKind.CONSUMER && s.name.includes(queueName))!;
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      expect(span.events.some((event) => event.name === 'exception')).toBe(true);
    } finally {
      await closeBullMQ();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  },
  20000,
);
