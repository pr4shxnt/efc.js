import { Worker, workerData, parentPort, isMainThread } from 'node:worker_threads';
import type { TaskDefinition } from '../types.js';

// ── Worker-thread side ────────────────────────────────────────────────────────
if (!isMainThread) {
  const { handlerPath, payload } = workerData as { handlerPath: string; payload: unknown };

  (async () => {
    try {
      const mod = await import(handlerPath) as Record<string, unknown>;
      const def = mod['default'] as TaskDefinition | undefined;
      if (!def || typeof def.handler !== 'function') {
        throw new Error(`[EFC] Thread runner: no valid task export in ${handlerPath}`);
      }
      await def.handler(payload);
      parentPort?.postMessage({ ok: true });
    } catch (err) {
      parentPort?.postMessage({ ok: false, error: String(err) });
    }
  })();
}

// ── Main-thread side ──────────────────────────────────────────────────────────
export function runInThread(handlerPath: string, payload: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./thread-runner.js', import.meta.url), {
      workerData: { handlerPath, payload },
    });

    worker.on('message', (msg: { ok: boolean; error?: string }) => {
      if (msg.ok) resolve();
      else reject(new Error(msg.error ?? 'Thread task failed'));
    });

    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Thread worker exited with code ${code}`));
    });
  });
}
