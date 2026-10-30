/** Internal process state shared by the package's ESM and CommonJS module graphs. */
export function processState<T>(name: string, initialize: () => T): T {
  const key = Symbol.for('express-file-cluster.runtime.v1.' + name);
  const globals = globalThis as Record<symbol, unknown>;
  if (!(key in globals)) globals[key] = initialize();
  return globals[key] as T;
}
