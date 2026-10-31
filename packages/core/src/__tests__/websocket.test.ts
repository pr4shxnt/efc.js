import { afterEach, expect, it } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket, type ClientOptions } from 'ws';
import { createTestApp } from '../testing.js';
import { attachWebSockets, type WebSocketOptions } from '../websocket.js';
import { signToken } from '../auth/index.js';
const clients: WebSocket[] = [],
  servers: http.Server[] = [],
  dirs: string[] = [];
afterEach(async () => {
  for (const ws of clients.splice(0)) ws.terminate();
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
async function boot(
  files: Record<string, string>,
  options: WebSocketOptions = {},
  requestTimeout?: number,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-ws-'));
  dirs.push(dir);
  for (const [name, source] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  }
  const app = await createTestApp({
    apiDir: dir,
    auth: { secret: 'ws-test', strategy: 'bearer' },
    globalMiddlewares: [
      (_req, res, next) => {
        res.set('x-ws-test', 'applied');
        res.cookie('handshake', 'yes');
        next();
      },
    ],
    ...(requestTimeout && { requestTimeout }),
  });
  const server = http.createServer(app);
  servers.push(server);
  attachWebSockets(server, app, options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  return { server, http: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}` };
}
function client(url: string, options?: ClientOptions) {
  const ws = new WebSocket(url, options);
  clients.push(ws);
  return ws;
}
async function connect(url: string, options?: ClientOptions) {
  const ws = client(url, options);
  await once(ws, 'open');
  return ws;
}
function rejected(url: string, options?: ClientOptions) {
  return new Promise<number>((resolve, reject) => {
    const ws = client(url, options);
    ws.on('error', () => {});
    ws.once('open', () => reject(new Error('Unexpected upgrade')));
    ws.once('unexpected-response', (_req, res) => {
      res.resume();
      ws.terminate();
      resolve(res.statusCode!);
    });
  });
}
const auth = JSON.stringify(path.resolve(import.meta.dirname, '../auth/index.ts'));
it('shares real middleware, auth, decoded params and async request context, while HTTP coexists', async () => {
  const host = await boot(
    {
      'chat/[id].js': `import {requireAuth,getCurrentUser} from ${auth}; export const middlewares=[requireAuth]; export const GET=(_req,res)=>res.json({http:true}); export const WS=(ws,req)=>ws.on('message',async(data,isBinary)=>{await Promise.resolve();ws.send(JSON.stringify({id:req.params.id,user:getCurrentUser()?.id,text:data.toString(),isBinary}));});`,
    },
    {},
    20,
  );
  expect(await rejected(host.ws + '/v1/api/chat/one')).toBe(401);
  const token = await signToken({ id: 'alice' });
  const headers = { Authorization: 'Bearer ' + token };
  const ws = client(host.ws + '/v1/api/chat/a%25', { headers });
  const handshake = once(ws, 'upgrade');
  await once(ws, 'open');
  const handshakeResponse = (await handshake)[0] as http.IncomingMessage;
  expect(handshakeResponse.headers['x-ws-test']).toBe('applied');
  expect(handshakeResponse.headers['set-cookie']?.[0]).toContain('handshake=yes');
  expect(handshakeResponse.headers['x-request-id']).toBeTruthy();
  expect(ws.extensions).toBe('');
  await new Promise((resolve) => setTimeout(resolve, 35)); // HTTP timeout must be cleared after 101.
  const response = once(ws, 'message');
  ws.send('hello');
  expect(JSON.parse((await response)[0].toString())).toEqual({
    id: 'a%',
    user: 'alice',
    text: 'hello',
    isBinary: false,
  });
  expect((await fetch(host.http + '/v1/api/chat/one', { headers })).status).toBe(200);
  const bob = await connect(host.ws + '/v1/api/chat/bob', {
    headers: { Authorization: 'Bearer ' + (await signToken({ id: 'bob' })) },
  });
  const a = once(ws, 'message'),
    b = once(bob, 'message');
  ws.send('alice again');
  bob.send('bob');
  const [aliceReply, bobReply] = await Promise.all([a, b]);
  expect(JSON.parse(aliceReply[0].toString()).user).toBe('alice');
  expect(JSON.parse(bobReply[0].toString()).user).toBe('bob');
});
it('enforces same-origin by default and supports an explicit browser-origin allowlist', async () => {
  const host = await boot({ 'socket.js': 'export const WS=ws=>ws.send("ready");' });
  expect(await rejected(host.ws + '/v1/api/socket', { origin: 'https://attacker.test' })).toBe(403);
  await connect(host.ws + '/v1/api/socket', { origin: host.http });
  const other = await boot(
    { 'socket.js': 'export const WS=()=>{};' },
    { origins: ['https://app.test'] },
  );
  await connect(other.ws + '/v1/api/socket', { origin: 'https://app.test' });
  expect(await rejected(other.ws + '/v1/api/socket', { origin: other.http })).toBe(403);
});
it('rejects unknown/HTTP-only upgrades without executing GET, and validates WS handshake schemas', async () => {
  const host = await boot({
    'http.js': 'let n=0;export const GET=(_req,res)=>res.json({n:++n});',
    'socket.js': `export const schema={WS:{query:{safeParse:q=>q.room==='ok'?{success:true,data:q}:{success:false}}}};export const WS=(ws,req)=>ws.send(req.query.room);`,
  });
  expect(await rejected(host.ws + '/v1/api/http')).toBe(404);
  expect((await (await fetch(host.http + '/v1/api/http')).json()).n).toBe(1);
  expect(await rejected(host.ws + '/v1/api/socket')).toBe(400);
  await connect(host.ws + '/v1/api/socket?room=ok');
  expect(await rejected(host.ws + '/unknown')).toBe(404);
});
it('enforces payload limits, catches handler failures and drains connections when the HTTP server closes', async () => {
  const host = await boot(
    {
      'echo.js': 'export const WS=ws=>ws.on("message",data=>ws.send(data));',
      'fail.js': 'export const WS=async()=>{throw new Error("private failure")};',
    },
    { maxPayload: 32 },
  );
  const oversized = await connect(host.ws + '/v1/api/echo');
  const rejectedPayload = once(oversized, 'close');
  oversized.send('x'.repeat(64));
  expect((await rejectedPayload)[0]).toBe(1009);
  const failed = client(host.ws + '/v1/api/fail');
  const failedClose = once(failed, 'close');
  const [code, reason] = await failedClose;
  expect(code).toBe(1011);
  expect(reason.toString()).toBe('Internal Server Error');
  const open = await connect(host.ws + '/v1/api/echo');
  const closing = once(open, 'close');
  await new Promise<void>((resolve) => host.server.close(() => resolve()));
  expect((await closing)[0]).toBe(1001);
});
it('times out abandoned middleware and terminates peers that ignore heartbeat pings', async () => {
  const host = await boot(
    {
      'stuck.js': 'export const middlewares=[()=>{}];export const WS=()=>{};',
      'live.js': 'export const WS=()=>{};',
    },
    { handshakeTimeoutMs: 30, heartbeatIntervalMs: 25 },
  );
  expect(await rejected(host.ws + '/v1/api/stuck')).toBe(408);
  const ws = client(host.ws + '/v1/api/live', { autoPong: false });
  const closed = once(ws, 'close');
  await once(ws, 'open');
  expect((await closed)[0]).toBe(1006);
});

it('supports CommonJS attachment with the ESM-backed packaged test helper', async () => {
  const require = createRequire(import.meta.url);
  const main = require('express-file-cluster') as { attachWebSockets: typeof attachWebSockets };
  const helper = require('express-file-cluster/testing') as { createTestApp: typeof createTestApp };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-ws-package-'));
  dirs.push(dir);
  fs.writeFileSync(
    path.join(dir, 'echo.mjs'),
    'export const WS=ws=>{ws.on("message",data=>ws.send(data));};',
  );
  const app = await helper.createTestApp({ apiDir: dir });
  const server = http.createServer(app);
  servers.push(server);
  const sockets = main.attachWebSockets(server, app);
  const connection = once(sockets, 'connection');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const ws = await connect(
    `ws://127.0.0.1:${(server.address() as { port: number }).port}/v1/api/echo`,
  );
  expect((await connection)[0]).toBe([...sockets.clients][0]);
  const echoed = once(ws, 'message');
  ws.send('packaged');
  expect((await echoed)[0].toString()).toBe('packaged');
});

it('rejects pipelined upgrades while an earlier HTTP response owns the socket without crashing', async () => {
  const host = await boot({
    'slow.mjs':
      'export const GET=async(_req,res)=>{await new Promise(r=>setTimeout(r,50));res.json({ok:true});};',
    'socket.mjs': 'export const WS=()=>{};',
  });
  const port = (host.server.address() as { port: number }).port;
  const socket = net.connect(port, '127.0.0.1');
  socket.on('error', () => {});
  try {
    const closed = once(socket, 'close');
    await once(socket, 'connect');
    socket.write(
      `GET /v1/api/slow HTTP/1.1\r\nHost: localhost\r\n\r\nGET /v1/api/socket HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`,
    );
    await closed;
    expect((await fetch(host.http + '/v1/api/slow')).status).toBe(200);
  } finally {
    socket.destroy();
  }
});

it('closes pending middleware upgrades promptly during drain', async () => {
  const host = await boot(
    { 'stuck.mjs': 'export const middlewares=[()=>{}];export const WS=()=>{};' },
    { handshakeTimeoutMs: 2000 },
  );
  const incoming = once(host.server, 'upgrade');
  const ws = client(host.ws + '/v1/api/stuck');
  ws.on('error', () => {});
  const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()));
  await incoming;
  const stopped = new Promise<void>((resolve) => host.server.close(() => resolve()));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all([closed, stopped]),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Shutdown waited for pending handshake timeout')),
          500,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
});

it('rejects overflowing payload/timer options and enforces the largest supported payload limit from frame headers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-ws-config-'));
  dirs.push(dir);
  const app = await createTestApp({ apiDir: dir });
  for (const name of ['maxPayload', 'heartbeatIntervalMs', 'handshakeTimeoutMs'] as const) {
    for (const value of [2147483648, 4294967296, Number.MAX_SAFE_INTEGER]) {
      expect(() => attachWebSockets(http.createServer(app), app, { [name]: value })).toThrow(
        '2147483647',
      );
    }
  }
  const host = await boot(
    { 'socket.mjs': 'export const WS=()=>{};' },
    { maxPayload: 2147483647, heartbeatIntervalMs: 0 },
  );
  const ws = await connect(host.ws + '/v1/api/socket');
  const closed = once(ws, 'close');
  // Declare a 2 GiB frame using only its header; no large allocation is needed.
  const header = Buffer.alloc(14);
  header[0] = 0x82;
  header[1] = 0xff;
  header.writeBigUInt64BE(2147483648n, 2);
  (ws as unknown as { _socket: net.Socket })._socket.write(header);
  expect((await closed)[0]).toBe(1009);
});
