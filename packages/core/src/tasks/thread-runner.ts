import { randomUUID } from 'node:crypto';
import { context } from '@opentelemetry/api';
import { injectTrace, extractTrace, type TraceCarrier } from '../tracing.js';
import { runWithContext } from '../context.js';
import { Worker, workerData, parentPort, isMainThread } from 'node:worker_threads';
import type { TaskDefinition } from '../types.js';
import { enqueue, ENQUEUE_BRIDGE } from './index.js';

// `{ thread: true }` tasks run here, in a worker_thread. The task queue lives on the main
// thread, so `enqueue()` inside the thread is bridged: the thread posts the call, the main
// thread runs the real enqueue() and posts back the outcome.

type FromThread = (
  | { type: 'done'; ok: true }
  | { type: 'done'; ok: false; error: string }
  | { type: 'enqueue'; id: number; name: string; payload: unknown; trace?: TraceCarrier }
) & { token: string };
type ToThread = { type: 'enqueued'; id: number; error?: string; token: string };

// ── Worker-thread side ────────────────────────────────────────────────────────
if (!isMainThread && parentPort && (workerData as { efcTask?: boolean })?.efcTask) {
  const port = parentPort;
  const {
    handlerPath,
    payload,
    token,
    trace: parentTrace,
  } = workerData as { handlerPath: string; payload: unknown; trace?: TraceCarrier; token: string };
  const waiting = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
  let seq = 0;
  // The port only keeps the thread alive while an enqueue waits for its answer, so a
  // finished task's thread still exits.
  port.unref();
  port.on('message', (msg: ToThread) => {
    if (msg?.type !== 'enqueued' || msg.token !== token) return;
    const w = waiting.get(msg.id);
    if (!w) return;
    waiting.delete(msg.id);
    if (waiting.size === 0) port.unref();
    if (msg.error === undefined) w.resolve();
    else w.reject(new Error(msg.error));
  });
  // On globalThis, so the task's own copy of express-file-cluster/tasks (ESM or CJS)
  // finds it too.
  (globalThis as Record<symbol, unknown>)[ENQUEUE_BRIDGE] = (name: string, payload: unknown) =>
    new Promise<void>((resolve, reject) => {
      const id = ++seq;
      waiting.set(id, { resolve, reject });
      port.ref();
      port.postMessage({
        type: 'enqueue',
        token,
        id,
        name,
        payload,
        ...(parentTrace && { trace: injectTrace() }),
      } satisfies FromThread);
    });

  (async () => {
    try {
      const mod = (await import(handlerPath)) as Record<string, unknown>;
      const def = mod['default'] as TaskDefinition | undefined;
      if (!def || typeof def.handler !== 'function') {
        throw new Error(`[EFC] Thread runner: no valid task export in ${handlerPath}`);
      }
      const ctx = parentTrace ? extractTrace(parentTrace) : context.active();
      // A thread has no SDK unless the app initializes one there. Preserve the
      // carrier for nested enqueue even with the API's no-op context manager.
      await runWithContext({ otelContext: ctx }, () =>
        context.with(ctx, () => def.handler(payload)),
      );
      port.postMessage({ type: 'done', ok: true, token } satisfies FromThread);
    } catch (err) {
      port.postMessage({ type: 'done', ok: false, error: String(err), token } satisfies FromThread);
    }
  })();
}

// ── Main-thread side ──────────────────────────────────────────────────────────
export function runInThread(handlerPath: string, payload: unknown, tracing = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const token = randomUUID();
    const worker = new Worker(new URL('./thread-runner.js', import.meta.url), {
      workerData: {
        efcTask: true,
        handlerPath,
        payload,
        token,
        ...(tracing && { trace: injectTrace() }),
      },
    });

    let completed = false;
    let exited = false;
    let settled = false;
    const pending = new Set<Promise<void>>();
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    worker.on('message', (message: unknown) => {
      if (
        !message ||
        typeof message !== 'object' ||
        (message as { token?: unknown }).token !== token
      )
        return;
      const msg = message as FromThread;
      if (msg.type === 'enqueue') {
        if (completed || !Number.isSafeInteger(msg.id) || typeof msg.name !== 'string') return;
        const reply = (error?: string) => {
          if (exited) return;
          try {
            worker.postMessage({
              type: 'enqueued',
              token,
              id: msg.id,
              ...(error !== undefined && { error }),
            } satisfies ToThread);
          } catch {
            /* An exited worker has nobody left waiting for the reply. */
          }
        };
        const parent = msg.trace ? extractTrace(msg.trace) : context.active();
        const operation = Promise.resolve()
          .then(() => context.with(parent, () => enqueue(msg.name, msg.payload)))
          .then(
            () => reply(),
            (err: unknown) => reply(err instanceof Error ? err.message : String(err)),
          );
        pending.add(operation);
        void operation.then(() => pending.delete(operation));
        return;
      }
      if (msg.type !== 'done' || typeof msg.ok !== 'boolean' || completed) return;
      completed = true;
      // The job owns this isolate. Wait for bridge acknowledgments, then dispose
      // timers/open handles before releasing its queue slot or retrying it.
      void Promise.allSettled([...pending])
        .then(() => worker.terminate())
        .then(
          () =>
            settle(
              msg.ok
                ? undefined
                : new Error(typeof msg.error === 'string' ? msg.error : 'Thread task failed'),
            ),
          (error: unknown) => settle(error instanceof Error ? error : new Error(String(error))),
        );
    });
    worker.on('error', (error) => {
      void worker.terminate().catch(() => {});
      settle(error);
    });
    worker.on('exit', (code) => {
      exited = true;
      if (!completed)
        settle(new Error(`Thread worker exited with code ${code} before reporting completion`));
    });
  });
}
