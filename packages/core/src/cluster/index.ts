import cluster from 'node:cluster';
import os from 'node:os';

interface ClusterOptions {
  workers?: number;
  onWorkerReady?: ((id: number) => void) | undefined;
  onWorkerCrash?: ((id: number, code: number) => void) | undefined;
}

export function runMaster(options: ClusterOptions = {}): void {
  const count = options.workers ?? os.cpus().length;

  console.log(`[EFC] Primary ${process.pid} starting ${count} workers`);

  for (let i = 0; i < count; i++) {
    cluster.fork();
  }

  cluster.on('online', (worker) => {
    options.onWorkerReady?.(worker.id);
  });

  cluster.on('exit', (worker, code, signal) => {
    const exitCode = code ?? (signal ? -1 : 0);
    console.warn(`[EFC] Worker ${worker.id} exited (code=${exitCode}), respawning…`);
    options.onWorkerCrash?.(worker.id, exitCode);
    cluster.fork();
  });
}

export { cluster };
