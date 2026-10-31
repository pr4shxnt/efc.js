import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const server = spawn(process.execPath, ['.next/standalone/server.js'], {
  env: { ...process.env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '3100' },
  stdio: 'inherit',
});
const exited = once(server, 'exit');
const base = 'http://127.0.0.1:3100';
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error('Standalone server exited before becoming ready');
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(2000) });
      await response.arrayBuffer();
      if (response.ok) { ready = true; break; }
    } catch { /* Wait for the server to start. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'Standalone server must start');
  for (const [path, status] of [['/', 200], ['/learn/setup', 200], ['/reference', 200], ['/favicon.ico', 200], ['/does-not-exist', 404]]) {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, status, path);
    const body = await response.text();
    if (status === 200 && path !== '/favicon.ico') {
      assert.match(body, /<html/);
      const asset = body.match(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/);
      assert.ok(asset, `Missing static asset on ${path}`);
      const assetResponse = await fetch(new URL(asset[1].replaceAll('&amp;', '&'), base), { signal: AbortSignal.timeout(10000) });
      assert.equal(assetResponse.status, 200, asset[1]);
      await assetResponse.arrayBuffer();
    }
  }
  for (const [path, contentType] of [
    ['/robots.txt', 'text/plain'],
    ['/sitemap.xml', 'application/xml'],
    ['/llms.txt', 'text/plain'],
    ['/llms-full.txt', 'text/plain'],
    ['/opengraph-image', 'image/png'],
    ['/learn/setup/opengraph-image', 'image/png'],
  ]) {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200, path);
    assert.ok(response.headers.get('content-type')?.includes(contentType), path);
    assert.ok((await response.arrayBuffer()).byteLength > 0, path);
  }
  console.log('Standalone smoke tests passed');
} finally {
  server.kill('SIGTERM');
  const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(timer);
}
