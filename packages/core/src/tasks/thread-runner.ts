import { Worker, workerData, parentPort, isMainThread } from 'node:worker_threads';
import type { TaskDefinition } from '../types.js';
import { enqueue, ENQUEUE_BRIDGE } from './index.js';

// `{ thread: true }` tasks run here, in a worker_thread. The task queue lives on the main
// thread, so `enqueue()` inside the thread is bridged: the thread posts the call, the main
// thread runs the real enqueue() and posts back the outcome.

type FromThread =
  | { type: 'done'; ok: true }
  | { type: 'done'; ok: false; error: string }
  | { type: 'enqueue'; id: number; name: string; payload: unknown };
type ToThread = { type: 'enqueued'; id: number; error?: string };

// ── Worker-thread side ────────────────────────────────────────────────────────
if (!isMainThread && parentPort && (workerData as { efcTask?: boolean })?.efcTask) {
  const port = parentPort;
  const { handlerPath, payload } = workerData as { handlerPath: string; payload: unknown };
  const waiting = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
  let seq = 0;
  // The port only keeps the thread alive while an enqueue waits for its answer, so a
  // finished task's thread still exits.
  port.unref();
  port.on('message', (msg: ToThread) => {
    if (msg?.type !== 'enqueued') return;
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
      port.postMessage({ type: 'enqueue', id, name, payload } satisfies FromThread);
    });

  (async () => {
    try {
      const mod = (await import(handlerPath)) as Record<string, unknown>;
      const def = mod['default'] as TaskDefinition | undefined;
      if (!def || typeof def.handler !== 'function') {
        throw new Error(`[EFC] Thread runner: no valid task export in ${handlerPath}`);
      }
      await def.handler(payload);
      port.postMessage({ type: 'done', ok: true } satisfies FromThread);
    } catch (err) {
      port.postMessage({ type: 'done', ok: false, error: String(err) } satisfies FromThread);
    }
  })();
}

// ── Main-thread side ──────────────────────────────────────────────────────────
export function runInThread(handlerPath: string, payload: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./thread-runner.js', import.meta.url), {
      workerData: { efcTask: true, handlerPath, payload },
    });

    worker.on('message', (msg: FromThread) => {
      if (msg.type === 'enqueue') {
        const reply = (error?: string) =>
          worker.postMessage({
            type: 'enqueued',
            id: msg.id,
            ...(error !== undefined && { error }),
          } satisfies ToThread);
        enqueue(msg.name, msg.payload).then(
          () => reply(),
          (err: unknown) => reply(err instanceof Error ? err.message : String(err)),
        );
        return;
      }
      if (msg.ok) resolve();
      else reject(new Error(msg.error ?? 'Thread task failed'));
    });

    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Thread worker exited with code ${code}`));
    });
  });
}
