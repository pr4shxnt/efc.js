import type { TaskDefinition, TaskOptions } from '../types.js';

export const taskRegistry = new Map<string, TaskDefinition>();

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

type EnqueueImpl = (name: string, payload: unknown) => Promise<void>;
let _impl: EnqueueImpl | null = null;

export function setEnqueueImpl(impl: EnqueueImpl): void {
  _impl = impl;
}

export async function enqueue<T>(name: string, payload: T): Promise<void> {
  if (!_impl) {
    throw new Error(
      `[EFC] Task queue not initialised. Set tasks.backend in ignite() config.`,
    );
  }
  return _impl(name, payload as unknown);
}

export function registerTask(name: string, def: TaskDefinition): void {
  taskRegistry.set(name, { ...def, name });
}
