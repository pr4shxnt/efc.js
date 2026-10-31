interface DrainOptions {
  transports: Promise<unknown>[];
  tasks: Array<() => Promise<unknown>>;
  cache: () => Promise<unknown>;
  tracing: () => Promise<unknown>;
}
/** Drain every producer/consumer before removing shared dependencies. Fail only
 * after all cleanup attempts, so a fast failure cannot cut off a slower job. */
export async function drainServices(options: DrainOptions): Promise<void> {
  const errors: unknown[] = [];
  const outcomes = await Promise.allSettled([
    ...options.transports,
    ...options.tasks.map((close) => Promise.resolve().then(close)),
  ]);
  for (const outcome of outcomes) if (outcome.status === 'rejected') errors.push(outcome.reason);
  for (const close of [options.cache, options.tracing]) {
    try {
      await close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Service shutdown failed');
}
