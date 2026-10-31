import { it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
const redis = process.env['EFC_TEST_REDIS_URL'] ?? 'redis://127.0.0.1:6379/15';
const redisUp = await new Promise<boolean>((resolve) => {
  const u = new URL(redis);
  const s = net.connect({ host: u.hostname, port: Number(u.port), timeout: 1000 });
  s.once('connect', () => {
    s.destroy();
    resolve(true);
  });
  s.once('error', () => resolve(false));
  s.once('timeout', () => {
    s.destroy();
    resolve(false);
  });
});
const dist = path.resolve(import.meta.dirname, '../../../dist');
it.skipIf(!redisUp || !fs.existsSync(path.join(dist, 'index.js')))(
  'preserves parentage through a CJS thread enqueue and flushes the SDK after draining on SIGTERM',
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-tracing-thread-'));
    fs.mkdirSync(path.join(dir, 'src', 'api'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src', 'tasks'), { recursive: true });
    const req = createRequire(import.meta.url);
    const modulePath = (id: string) => JSON.stringify(req.resolve(id));
    const queue = 'otelthread' + Math.random().toString(36).slice(2, 9);
    fs.writeFileSync(
      path.join(dir, 'src', 'api', 'start.mjs'),
      `import {enqueue} from ${JSON.stringify(path.join(dist, 'tasks', 'index.cjs'))};export const POST=async(_req,res)=>{await enqueue('Thread',{value:'unchanged'});res.status(202).end();};`,
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'tasks', 'Thread.mjs'),
      `import {enqueue} from ${JSON.stringify(path.join(dist, 'tasks', 'index.cjs'))};export default {options:{thread:true},handler:async(payload)=>{await enqueue('Final',payload);}};`,
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'tasks', 'Final.mjs'),
      `import {trace} from ${modulePath('@opentelemetry/api')};import {cache} from ${JSON.stringify(path.join(dist, 'index.js'))};export default {options:{},handler:async(payload)=>{await new Promise(r=>setTimeout(r,50));process.kill(process.pid,'SIGTERM');await new Promise(r=>setTimeout(r,50));console.log('FINAL',JSON.stringify({payload,traceId:trace.getActiveSpan()?.spanContext().traceId,cache:await cache.get('drain')}));}};`,
    );
    fs.writeFileSync(
      path.join(dir, 'main.mjs'),
      `import {context,trace} from ${modulePath('@opentelemetry/api')};import {AsyncLocalStorageContextManager} from ${modulePath('@opentelemetry/context-async-hooks')};import {TracerProvider,InMemorySpanExporter,SimpleSpanProcessor} from ${modulePath('@opentelemetry/sdk-trace')};import {ignite,gracefulShutdown,cache} from ${JSON.stringify(path.join(dist, 'index.js'))};const exporter=new InMemorySpanExporter();const provider=new TracerProvider({spanProcessors:[new SimpleSpanProcessor({exporter})]});context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());trace.setGlobalTracerProvider(provider);const server=await ignite({cluster:false,port:0,dashboard:false,logging:false,cache:{backend:'memory'},tracing:{shutdown:async()=>{await provider.forceFlush();console.log('FLUSHED',JSON.stringify(exporter.getFinishedSpans().filter(s=>s.kind===4||s.kind===1).map(s=>({name:s.name,traceId:s.spanContext().traceId,spanId:s.spanContext().spanId}))));await provider.shutdown();}},tasks:{backend:'bullmq',queue:${JSON.stringify(queue)},redisUrl:${JSON.stringify(redis)}}});await cache.set('drain','alive');gracefulShutdown(server,5000);console.log('READY',server.address().port);`,
    );
    const child = spawn(process.execPath, [path.join(dir, 'main.mjs')], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      output += data;
    });
    const exit = new Promise<number | null>((resolve) => child.once('exit', resolve));
    try {
      const started = Date.now();
      while (!/READY (\d+)/.test(output)) {
        if (Date.now() - started > 10000) throw new Error(output || 'worker did not start');
        await new Promise((r) => setTimeout(r, 30));
      }
      const port = output.match(/READY (\d+)/)![1];
      const traceId = 'f'.repeat(32);
      const response = await fetch(`http://127.0.0.1:${port}/v1/api/start`, {
        method: 'POST',
        headers: { traceparent: `00-${traceId}-${'a'.repeat(16)}-01` },
      });
      expect(response.status).toBe(202);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const code = await Promise.race([
          exit,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(output)), 15000);
          }),
        ]);
        expect(code, output).toBe(0);
      } finally {
        clearTimeout(timer);
      }
      const final = JSON.parse(output.match(/FINAL (.+)/)![1]!);
      expect(final).toEqual({ payload: { value: 'unchanged' }, traceId, cache: 'alive' });
      const spans = JSON.parse(output.match(/FLUSHED (.+)/)![1]!) as Array<{ traceId: string }>;
      expect(spans).toHaveLength(3);
      expect(spans.every((s) => s.traceId === traceId)).toBe(true);
    } finally {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
        await exit;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
  30000,
);
