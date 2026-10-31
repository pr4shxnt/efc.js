import { it, expect } from 'vitest';
import { drainServices } from '../shutdown.js';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
it('keeps shared cache and telemetry alive until every task drain settles, even if another backend fails', async () => {
  const job = deferred();
  const started = deferred();
  const seen: string[] = [];
  const result = drainServices({
    transports: [Promise.resolve()],
    tasks: [
      async () => {
        seen.push('failed');
        throw new Error('backend failed');
      },
      async () => {
        started.resolve();
        await job.promise;
        seen.push('job finished');
      },
    ],
    cache: async () => {
      seen.push('cache closed');
    },
    tracing: async () => {
      seen.push('sdk closed');
    },
  });
  const failure = expect(result).rejects.toThrow('Service shutdown failed');
  await started.promise;
  await Promise.resolve();
  expect(seen).toEqual(['failed']);
  job.resolve();
  await failure;
  expect(seen).toEqual(['failed', 'job finished', 'cache closed', 'sdk closed']);
});
it('attempts SDK shutdown after cache failure and aggregates errors without false success', async () => {
  let flushed = false;
  const failure = await drainServices({
    transports: [],
    tasks: [],
    cache: async () => {
      throw new Error('cache');
    },
    tracing: async () => {
      flushed = true;
      throw new Error('sdk');
    },
  }).catch((error) => error);
  expect(flushed).toBe(true);
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure.errors).toHaveLength(2);
});
