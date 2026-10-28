import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `{ thread: true }` tasks, against the built package — the runner is loaded by path into a
// worker_thread, which only the build can prove (it once wasn't emitted at all, so every
// thread task failed with "Cannot find module dist/thread-runner.js").
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist');
// Skip only when nothing is built: a build without thread-runner.js must fail, not skip.
const distBuilt = fs.existsSync(path.join(DIST, 'index.js'));
const REDIS_URL = process.env['EFC_TEST_REDIS_URL'] ?? 'redis://127.0.0.1:6379/15';

const redisUp = await new Promise<boolean>((resolve) => {
  const { hostname, port } = new URL(REDIS_URL);
  const s = net.connect({ host: hostname, port: Number(port || 6379), timeout: 1000 });
  s.once('connect', () => (s.destroy(), resolve(true)));
  s.once('error', () => resolve(false));
  s.once('timeout', () => (s.destroy(), resolve(false)));
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-thread-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const [file, src] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), src);
  }
  return dir;
}

function run(dir: string, entry: string, timeoutMs: number) {
  return new Promise<{ code: number | null; out: string; timedOut: boolean }>((resolve) => {
    const child = spawn(process.execPath, [entry], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: null, out, timedOut: true });
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, out, timedOut: false });
    });
  });
}

const tasks = JSON.stringify(path.join(DIST, 'tasks', 'index.js'));

describe.skipIf(!distBuilt)('thread: true tasks (built package)', () => {
  it('runs in a worker thread, bridges enqueue() to the main thread, and lets the thread exit', async () => {
    const dir = project({
      'Heavy.js': `import { threadId } from 'node:worker_threads';
import { defineTask, enqueue } from ${tasks};
export default defineTask({ thread: true }, async (p) => {
  console.log('THREAD', threadId);
  await enqueue('Next', { n: p.n * 2 });
  try { await enqueue('Missing', {}); } catch (e) { console.log('REJECTED', e.message); }
});`,
      'main.mjs': `import { threadId } from 'node:worker_threads';
import { setEnqueueImpl } from ${tasks};
import { runInThread } from ${JSON.stringify(path.join(DIST, 'thread-runner.js'))};
const calls = [];
setEnqueueImpl(async (name, payload) => {
  if (name === 'Missing') throw new Error('no task named Missing');
  calls.push([name, payload]);
});
console.log('MAIN', threadId);
await runInThread(new URL('./Heavy.js', import.meta.url).href, { n: 21 });
console.log('CALLS', JSON.stringify(calls));
// No process.exit: a leaked thread would keep the process alive past the timeout.`,
    });
    const { code, out, timedOut } = await run(dir, 'main.mjs', 15_000);
    expect(timedOut, out).toBe(false);
    expect(code, out).toBe(0);
    expect(out).toMatch(/MAIN 0/);
    expect(out).toMatch(/THREAD [1-9]/);
    expect(out).toContain('CALLS [["Next",{"n":42}]]');
    expect(out).toContain('REJECTED no task named Missing');
  }, 30_000);

  it.skipIf(!redisUp)(
    'a thread task enqueues the next task through BullMQ',
    async () => {
      const dir = project({
        'src/tasks/Heavy.js': `import { threadId } from 'node:worker_threads';
import { defineTask, enqueue } from ${tasks};
export default defineTask({ thread: true, retries: 0 }, async (p) => {
  await enqueue('Next', { from: threadId, n: p.n });
});`,
        'src/tasks/Next.js': `import { defineTask } from ${tasks};
export default defineTask({ retries: 0 }, async (p) => { console.log('NEXT', JSON.stringify(p)); process.exit(0); });`,
        'main.mjs': `import { ignite } from ${JSON.stringify(path.join(DIST, 'index.js'))};
import { enqueue } from ${tasks};
await ignite({ cluster: false, port: 0, logging: { level: 'warn' },
  tasks: { backend: 'bullmq', redisUrl: ${JSON.stringify(REDIS_URL)}, queue: 'efc-thread-' + Date.now() } });
await enqueue('Heavy', { n: 7 });`,
      });
      const { out, timedOut } = await run(dir, 'main.mjs', 20_000);
      expect(timedOut, out).toBe(false);
      const next = /NEXT (.*)/.exec(out);
      expect(next, out).not.toBeNull();
      const payload = JSON.parse(next![1]!) as { from: number; n: number };
      expect(payload.n).toBe(7);
      expect(payload.from).toBeGreaterThan(0); // enqueued from inside a worker thread
    },
    30_000,
  );
});
