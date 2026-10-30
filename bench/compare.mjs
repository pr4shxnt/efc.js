/** Ratio gate: cancel runner speed using the fastest contender in the same run. */
export function compareResults(current, baseline, tolerance = 10) {
  if (!Number.isFinite(tolerance) || tolerance < 0)
    throw new Error('Tolerance must be a finite, nonnegative percentage');
  const engines = Object.keys(current ?? {});
  if (!engines.length) throw new Error('Benchmark results are empty');
  const failures = [];
  const names = (value) => Object.keys(value ?? {}).sort();
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const ratio = (contenders, label) => {
    if (!contenders?.EFC) throw new Error(`${label}: EFC result is missing`);
    const times = Object.values(contenders).map((stats) => stats.meanMs);
    if (times.length < 2 || times.some((n) => !Number.isFinite(n) || n <= 0))
      throw new Error(`${label}: invalid timings or missing competitor`);
    return contenders.EFC.meanMs / Math.min(...times);
  };
  for (const engine of engines) {
    const before = baseline?.[engine];
    const now = current[engine];
    if (!before || !names(now).length || !same(names(now), names(before)))
      throw new Error(`${engine}: operations do not match the baseline`);
    for (const op of names(now)) {
      if (!same(names(now[op]), names(before[op])))
        throw new Error(`${engine} ${op}: contenders do not match the baseline`);
      const prior = ratio(before[op], `${engine} ${op} baseline`);
      const latest = ratio(now[op], `${engine} ${op}`);
      if (latest > prior * (1 + tolerance / 100) + Number.EPSILON)
        failures.push(`${engine} ${op}: ${prior.toFixed(2)}× → ${latest.toFixed(2)}× the fastest`);
    }
  }
  return failures;
}
