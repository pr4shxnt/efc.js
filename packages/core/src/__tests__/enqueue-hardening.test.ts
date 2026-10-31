import { it, expect, vi, afterEach } from 'vitest';
const mocks = vi.hoisted(() => ({
  ready: Promise.resolve() as Promise<void>,
  add: vi.fn(),
  send: vi.fn(),
}));
vi.mock('bullmq', () => ({
  Queue: class {
    on() {}
    waitUntilReady() {
      return mocks.ready;
    }
    add(...args: unknown[]) {
      return mocks.add(...args);
    }
    async getJobSchedulers() {
      return [];
    }
    async close() {}
  },
  Worker: class {
    on() {}
    async close() {}
  },
}));
vi.mock('pg-boss', () => ({
  PgBoss: class {
    on() {}
    async start() {}
    async createQueue() {}
    async work() {}
    async getSchedules() {
      return [];
    }
    async stop() {}
    send(...args: unknown[]) {
      return mocks.send(...args);
    }
  },
}));
import { registerTask, enqueue, taskRegistry } from '../tasks/index.js';
import { initBullMQ, closeBullMQ, whenSchedulesSynced } from '../tasks/bullmq-backend.js';
import { initPgBoss, closePgBoss } from '../tasks/pgboss-backend.js';
afterEach(async () => {
  await Promise.all([closeBullMQ(), closePgBoss()]);
  taskRegistry.clear();
  vi.clearAllMocks();
});
it('does not submit a timed-out Redis enqueue after its readiness wait eventually completes', async () => {
  let ready!: () => void;
  mocks.ready = new Promise((resolve) => {
    ready = resolve;
  });
  registerTask('Work', { name: 'Work', options: {}, handler: async () => {} });
  await initBullMQ({
    redisUrl: 'redis://127.0.0.1:6379',
    queue: 'test',
    concurrency: 1,
    enqueueTimeout: 5,
  });
  await expect(enqueue('Work', {})).rejects.toThrow('did not respond');
  ready();
  await whenSchedulesSynced();
  await Promise.resolve();
  expect(mocks.add).not.toHaveBeenCalled();
});
it('does not report pg-boss rejection as a successfully queued job', async () => {
  registerTask('Work', { name: 'Work', options: {}, handler: async () => {} });
  mocks.send.mockResolvedValue(null);
  await initPgBoss({
    connectionString: 'postgres://localhost/test',
    queue: 'test',
    concurrency: 1,
    enqueueTimeout: 100,
  });
  await expect(enqueue('Work', {})).rejects.toThrow('did not accept');
});
