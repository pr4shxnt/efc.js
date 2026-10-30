/** Deterministic, exact call counts; every contender uses the same round offsets. */
export function roundPlan(iterations, warmup, rounds) {
  for (const [name, value, minimum] of [
    ['iterations', iterations, 1],
    ['warmup', warmup, 0],
    ['rounds', rounds, 1],
  ]) {
    if (!Number.isSafeInteger(value) || value < minimum)
      throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  if (rounds > iterations) throw new Error('rounds cannot exceed iterations');
  let offset = 0;
  return Array.from({ length: rounds }, (_, index) => {
    const n = Math.floor(iterations / rounds) + (index < iterations % rounds ? 1 : 0);
    const w = Math.floor(warmup / rounds) + (index < warmup % rounds ? 1 : 0);
    const entry = { n, warmup: w, offset };
    offset += n + w;
    return entry;
  });
}
