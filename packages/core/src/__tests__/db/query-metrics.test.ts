import { afterEach, it, expect } from 'vitest';
import {
  configureQueryLog,
  countStatement,
  traceOps,
  getQueryMetrics,
  resetQueryMetrics,
} from '../../db/query-log.js';
import { configureLogger } from '../../logger.js';

afterEach(() => {
  configureQueryLog(false);
});
it('collects successes/failures, inclusive statement counts and latency summaries without exposing parameters', async () => {
  configureLogger(false);
  configureQueryLog({ queries: { metrics: true, slowMs: 0, nPlusOne: false } });
  let fail = false;
  const model = traceOps(
    'User',
    {
      find: async (_privateValue: string) => {
        countStatement();
        await Promise.resolve();
        countStatement();
        if (fail) throw new Error('private failure detail');
        return 1;
      },
    },
    ['find'],
  );
  expect(await model.find('private parameter')).toBe(1);
  fail = true;
  await expect(model.find('private parameter')).rejects.toThrow('private failure detail');
  const snapshot = getQueryMetrics();
  expect(snapshot.enabled).toBe(true);
  expect(snapshot.entries).toHaveLength(1);
  expect(snapshot.entries[0]).toMatchObject({
    model: 'User',
    op: 'find',
    calls: 2,
    errors: 1,
    statements: 4,
    slow: 2,
  });
  expect(snapshot.entries[0]!.meanMs).toBe(snapshot.entries[0]!.totalMs / 2);
  expect(snapshot.entries[0]!.minMs).toBeLessThanOrEqual(snapshot.entries[0]!.maxMs);
  expect(JSON.stringify(snapshot)).not.toContain('private');
  snapshot.entries[0]!.calls = 123;
  expect(getQueryMetrics().entries[0]!.calls).toBe(2);
});
it('bounds cardinality, reports dropped operation observations and supports reset/reconfigure', async () => {
  configureLogger(false);
  configureQueryLog({ queries: { metrics: { maxEntries: 1 }, nPlusOne: false } });
  const first = traceOps('A', { count: async () => 1 }, ['count']);
  const second = traceOps('B', { count: async () => 2 }, ['count']);
  await first.count();
  await second.count();
  await second.count();
  await first.count();
  expect(getQueryMetrics()).toMatchObject({ dropped: 2, entries: [{ model: 'A', calls: 2 }] });
  resetQueryMetrics();
  expect(getQueryMetrics()).toMatchObject({ enabled: true, dropped: 0, entries: [] });
  await second.count();
  expect(getQueryMetrics().entries[0]!.model).toBe('B');
  configureQueryLog(false);
  expect(getQueryMetrics()).toMatchObject({ enabled: false, entries: [] });
  await first.count();
  expect(getQueryMetrics().entries).toEqual([]);
});
it('leaves metrics disabled by default and rejects invalid bounds', async () => {
  configureQueryLog({ queries: true });
  const model = traceOps('A', { find: async () => [] }, ['find']);
  await model.find();
  expect(getQueryMetrics()).toMatchObject({ enabled: false, entries: [] });
  for (const maxEntries of [-1, NaN, Infinity, 1.5])
    expect(() => configureQueryLog({ queries: { metrics: { maxEntries } } })).toThrow(
      'nonnegative safe integer',
    );
  configureQueryLog({ queries: { metrics: { maxEntries: 0 } } });
  expect(getQueryMetrics().enabled).toBe(false);
});
