import type { Job } from 'bullmq';
import { taskRegistry, setEnqueueImpl } from './index.js';
import { runInThread } from './thread-runner.js';

interface BullMQOpts {
  redisUrl: string;
  concurrency: number;
}

export async function initBullMQ(opts: BullMQOpts): Promise<void> {
  let bullmq: typeof import('bullmq');
  try {
    bullmq = await import('bullmq');
  } catch {
    throw new Error('[EFC] bullmq is not installed. Run: npm install bullmq');
  }

  const connection = parseRedisUrl(opts.redisUrl);
  const queue = new bullmq.Queue('efc', { connection });

  const worker = new bullmq.Worker(
    'efc',
    async (job: Job) => {
      const def = taskRegistry.get(job.name);
      if (!def) {
        throw new Error(`[EFC] No task registered for name: ${job.name}`);
      }

      if (def.options.thread && def.filePath) {
        await runInThread(def.filePath, job.data);
      } else {
        await def.handler(job.data);
      }
    },
    { connection, concurrency: opts.concurrency },
  );

  worker.on('failed', (job: Job | undefined, err: Error) => {
    console.error(`[EFC] Task ${job?.name ?? 'unknown'} failed:`, err.message);
  });

  worker.on('completed', (job: Job) => {
    console.log(`[EFC] Task ${job.name} completed (id=${job.id})`);
  });

  setEnqueueImpl(async (name, payload) => {
    const def = taskRegistry.get(name);
    if (!def) {
      throw new Error(
        `[EFC] Cannot enqueue unknown task: "${name}". Is the task file in tasksDir?`,
      );
    }

    await queue.add(name, payload, {
      attempts: def.options.retries ?? 3,
      backoff: {
        type: def.options.backoff ?? 'exponential',
        delay: 1000,
      },
    });
  });

  console.log('[EFC] BullMQ backend initialised');
}

function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  try {
    const u = new URL(url);
    const result: { host: string; port: number; password?: string } = {
      host: u.hostname || 'localhost',
      port: parseInt(u.port || '6379', 10),
    };
    if (u.password) result.password = u.password;
    return result;
  } catch {
    return { host: 'localhost', port: 6379 };
  }
}
