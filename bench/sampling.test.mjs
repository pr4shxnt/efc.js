import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundPlan } from './sampling.mjs';
test('distributes exact measurement/warmup budgets with contiguous deterministic offsets', () => {
  const plan = roundPlan(5000, 1000, 11);
  assert.equal(
    plan.reduce((n, item) => n + item.n, 0),
    5000,
  );
  assert.equal(
    plan.reduce((n, item) => n + item.warmup, 0),
    1000,
  );
  assert.equal(plan[0].offset, 0);
  for (let i = 1; i < plan.length; i++)
    assert.equal(plan[i].offset, plan[i - 1].offset + plan[i - 1].n + plan[i - 1].warmup);
  assert.deepEqual(plan, roundPlan(5000, 1000, 11));
  assert.equal(
    roundPlan(3, 0, 3).reduce((n, item) => n + item.warmup, 0),
    0,
  );
});
test('rejects empty/nonfinite/fractional budgets and more rounds than measured calls', () => {
  for (const args of [
    [0, 0, 1],
    [1, -1, 1],
    [1, 0, 2],
    [1, 0, 0],
    [NaN, 0, 1],
    [2, 1.5, 1],
    [Infinity, 0, 1],
  ])
    assert.throws(() => roundPlan(...args));
});
