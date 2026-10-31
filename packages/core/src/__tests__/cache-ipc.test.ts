import { it, expect, vi, afterEach } from 'vitest';
import { connectPrimaryCache } from '../cache/ipc.js';
const descriptor = Object.getOwnPropertyDescriptor(process, 'connected');
const original = process.send;
afterEach(() => {
  process.send = original;
  if (descriptor) Object.defineProperty(process, 'connected', descriptor);
  else delete (process as { connected?: boolean }).connected;
  vi.restoreAllMocks();
});
it('rejects pending cache calls on close and handles disconnected send errors without hanging', async () => {
  Object.defineProperty(process, 'connected', { value: true, configurable: true });
  process.send = ((msg: Record<string, unknown>, callback: (error: Error | null) => void) => {
    if (msg.op === 'ping')
      queueMicrotask(() =>
        process.emit(
          'message',
          { __efcCache: true, id: msg.id, ok: true, result: 'pong' },
          undefined,
        ),
      );
    callback(null);
    return true;
  }) as typeof process.send;
  const backend = await connectPrimaryCache();
  expect(backend).not.toBeNull();
  const pending = backend!.get('key');
  const rejected = expect(pending).rejects.toThrow('closed');
  await backend!.close();
  await rejected;
  await expect(backend!.get('key')).rejects.toThrow('closed');
});
it('rejects IPC send callback failures and removes their pending timers', async () => {
  Object.defineProperty(process, 'connected', { value: true, configurable: true });
  process.send = ((msg: Record<string, unknown>, callback: (error: Error | null) => void) => {
    if (msg.op === 'ping') {
      queueMicrotask(() =>
        process.emit(
          'message',
          { __efcCache: true, id: msg.id, ok: true, result: 'pong' },
          undefined,
        ),
      );
      callback(null);
    } else callback(new Error('channel gone'));
    return true;
  }) as typeof process.send;
  const backend = await connectPrimaryCache();
  try {
    await expect(backend!.get('key')).rejects.toThrow('channel gone');
  } finally {
    await backend!.close();
  }
});
