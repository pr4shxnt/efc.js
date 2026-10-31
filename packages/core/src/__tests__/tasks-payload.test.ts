import { it, expect } from 'vitest';
import { boxPgPayload, unboxPgPayload } from '../tasks/payload.js';
it('round-trips pg-boss JSON payloads, including every reserved wrapper-key shape', () => {
  for (const payload of [
    { __efcValue: 'business value' },
    { __efcValue: 'business value', amount: 10 },
    { __efcValue: { x: 1 }, __efcBox: 1 },
    { __efcBox: 1, plain: true },
    null,
    false,
    0,
    '',
    'text',
    [1, 2],
    { data: [] },
  ]) {
    const stored = JSON.parse(JSON.stringify(boxPgPayload(payload)));
    expect(unboxPgPayload(stored)).toEqual(payload);
  }
  expect(unboxPgPayload(boxPgPayload(undefined))).toEqual({});
});
it('reads old primitive boxes without unwrapping ordinary legacy objects or inherited keys', () => {
  expect(unboxPgPayload({ __efcValue: 3 })).toBe(3);
  expect(unboxPgPayload({ __efcValue: 'user data', other: true })).toEqual({
    __efcValue: 'user data',
    other: true,
  });
  const value = Object.assign(Object.create({ __efcValue: 'inherited' }), { id: 1 });
  expect(unboxPgPayload(value)).toBe(value);
});
