import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareResults } from './compare.mjs';
const results = (efc = 1, competitor = 1) => ({
  postgresql: { find: { EFC: { meanMs: efc }, Drizzle: { meanMs: competitor } } },
});
test('10% boundary passes; a greater regression fails; uniform machine slowdown cancels', () => {
  assert.deepEqual(compareResults(results(1.1), results()), []);
  assert.equal(compareResults(results(1.1001), results()).length, 1);
  assert.deepEqual(compareResults(results(10, 10), results()), []);
});
test('missing coverage and invalid input fail instead of producing a green nightly run', () => {
  for (const [current, base] of [
    [{}, results()],
    [results(), {}],
    [{ postgresql: {} }, results()],
    [results(NaN), results()],
    [results(0), results()],
    [results(), { postgresql: { find: { EFC: { meanMs: 1 } } } }],
  ])
    assert.throws(() => compareResults(current, base));
  for (const tolerance of [NaN, -1, Infinity])
    assert.throws(() => compareResults(results(), results(), tolerance));
});
test('explicit single-engine runs can compare against a multi-engine baseline', () => {
  assert.deepEqual(compareResults(results(), { ...results(), mongodb: { find: {} } }), []);
});
