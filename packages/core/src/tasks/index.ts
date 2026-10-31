import { processState } from '../process-state.js';
import type { TaskDefinition, TaskOptions } from '../types.js';

type EnqueueImpl = (name: string, payload: unknown) => Promise<void>;
const state = processState('tasks', () => ({
  registry: new Map<string, TaskDefinition>(),
  impl: null as EnqueueImpl | null,
}));
export const taskRegistry = state.registry;

type HandlerFn<T> = (payload: T) => Promise<void>;
type DefineTaskOverload = {
  <T>(handler: HandlerFn<T>): TaskDefinition<T>;
  <T>(options: TaskOptions, handler: HandlerFn<T>): TaskDefinition<T>;
};

export const defineTask: DefineTaskOverload = <T>(
  handlerOrOptions: HandlerFn<T> | TaskOptions,
  maybeHandler?: HandlerFn<T>,
): TaskDefinition<T> => {
  let options: TaskOptions = {};
  let handler: HandlerFn<T>;

  if (typeof handlerOrOptions === 'function') {
    handler = handlerOrOptions;
  } else {
    options = handlerOrOptions;
    if (!maybeHandler) throw new Error('[EFC] defineTask: handler function is required');
    handler = maybeHandler;
  }

  return {
    handler: handler as (payload: unknown) => Promise<void>,
    options,
    name: '',
  };
};

export function setEnqueueImpl(impl: EnqueueImpl): void {
  state.impl = impl;
}

/** Set inside `{ thread: true }` task threads: forwards enqueue() to the main thread. */
export const ENQUEUE_BRIDGE = Symbol.for('efc.enqueueBridge');

export async function enqueue<T>(name: string, payload: T): Promise<void> {
  const bridge = (globalThis as Record<symbol, unknown>)[ENQUEUE_BRIDGE] as EnqueueImpl | undefined;
  if (!state.impl && bridge) return bridge(name, payload as unknown);
  if (!state.impl) {
    throw new Error(
      `[EFC] Cannot enqueue task "${name}": task queue not initialised. Set tasks.backend in ignite() config.`,
    );
  }
  return state.impl(name, payload as unknown);
}

export function registerTask(name: string, def: TaskDefinition): void {
  taskRegistry.set(name, { ...def, name });
}

/**
 * Returns a read-only snapshot of all registered tasks.
 * Each entry contains the task name and its configured options.
 *
 * @example
 * const tasks = listTasks();
 * console.log(tasks.map(t => t.name));
 */
export function listTasks(): ReadonlyArray<{ name: string; options: TaskOptions }> {
  return Array.from(taskRegistry.values()).map(({ name, options }) => ({ name, options }));
}
