import http from 'node:http';
import type { Socket } from 'node:net';
import type { Express, Request, RequestHandler, Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { getRequestContext, runWithContext } from './context.js';
import { getLogger } from './logger.js';
import { processState } from './process-state.js';

export type WebSocketHandler = (socket: WebSocket, request: Request) => void | Promise<void>;
export interface WebSocketOptions {
  /** Default 1 MiB. Compression is disabled. */
  maxPayload?: number;
  /** Browser origins; default is same-origin. Clients without Origin are allowed. */
  origins?: string[];
  /** Default 30 seconds; 0 disables heartbeat. */
  heartbeatIntervalMs?: number;
  /** Default 10 seconds to finish upgrade middleware. */
  handshakeTimeoutMs?: number;
}
interface Upgrade {
  options: WebSocketOptions;
  accepted: boolean;
  accept: (handler: WebSocketHandler, req: Request, res: Response) => void;
}
const UPGRADE = Symbol.for('express-file-cluster.websocket-upgrade.v1');
type UpgradeRequest = Request & { [UPGRADE]?: Upgrade };
interface State {
  wss: WebSocketServer;
  pending: Set<Socket>;
  stopHeartbeat: () => void;
  closing?: Promise<void>;
}
const servers = processState('websocket-servers', () => new WeakMap<http.Server, State>());
export const isUpgrade = (req: Request): boolean => !!(req as UpgradeRequest)[UPGRADE];

/** Gate mounted before file middleware: ordinary HTTP continues to its own handler. */
export const websocketOnly: RequestHandler = (req, res, next) => {
  const upgrade = (req as UpgradeRequest)[UPGRADE];
  if (!upgrade) return next('route');
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let valid = false;
    try {
      const parsed = new URL(origin);
      valid =
        parsed.origin === origin &&
        ['http:', 'https:'].includes(parsed.protocol) &&
        (upgrade.options.origins
          ? upgrade.options.origins.includes(origin)
          : origin === `${req.protocol}://${req.get('host')}`);
    } catch {
      /* malformed and opaque origins are refused */
    }
    if (!valid) {
      res.status(403).json({ error: 'WebSocket origin rejected' });
      return;
    }
  }
  next();
};
export function websocketHandler(handler: WebSocketHandler): RequestHandler {
  return (req, res) => {
    (req as UpgradeRequest)[UPGRADE]!.accept(handler, req, res);
  };
}

/** Attach upgrade handling to an EFC HTTP app/server (also useful with createTestApp). */
export function attachWebSockets(
  server: http.Server,
  app: Express,
  options: WebSocketOptions = {},
): WebSocketServer {
  if (servers.has(server)) throw new Error('[EFC] WebSockets already attached to this server');
  const maxPayload = options.maxPayload ?? 1024 * 1024;
  const heartbeat = options.heartbeatIntervalMs ?? 30000;
  const timeout = options.handshakeTimeoutMs ?? 10000;
  for (const [name, value, minimum] of [
    ['maxPayload', maxPayload, 1],
    ['heartbeatIntervalMs', heartbeat, 0],
    ['handshakeTimeoutMs', timeout, 1],
  ] as const) {
    // ws coerces maxPayload to int32; Node timers also have a signed int32 ceiling.
    if (!Number.isSafeInteger(value) || value < minimum || value > 0x7fffffff)
      throw new Error(`[EFC] websocket.${name} must be an integer from ${minimum} to 2147483647`);
  }
  for (const origin of options.origins ?? []) {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol))
      throw new Error('[EFC] websocket.origins must contain HTTP(S) origins');
  }
  const wss = new WebSocketServer({ noServer: true, maxPayload, perMessageDeflate: false });
  // ws writes the 101 response itself; preserve ordinary middleware headers without
  // allowing them to replace protocol framing/negotiation headers.
  const reserved = new Set([
    'upgrade',
    'connection',
    'sec-websocket-accept',
    'sec-websocket-protocol',
    'sec-websocket-extensions',
    'content-length',
    'transfer-encoding',
    'content-type',
  ]);
  wss.on('headers', (headers, incoming) => {
    const response = (incoming as Request).res;
    for (const [name, value] of Object.entries(response?.getHeaders() ?? {})) {
      if (reserved.has(name.toLowerCase()) || value === undefined) continue;
      for (const entry of Array.isArray(value) ? value : [value])
        headers.push(name + ': ' + String(entry));
    }
  });
  const alive = new WeakSet<WebSocket>();
  const interval = heartbeat
    ? setInterval(() => {
        for (const client of wss.clients) {
          if (!alive.has(client)) {
            client.terminate();
            continue;
          }
          alive.delete(client);
          if (client.readyState === WebSocket.OPEN) client.ping();
        }
      }, heartbeat)
    : undefined;
  interval?.unref();
  const state: State = {
    wss,
    pending: new Set(),
    stopHeartbeat: () => {
      if (interval) clearInterval(interval);
    },
  };
  servers.set(server, state);
  server.on('upgrade', (incoming, socket, head) => {
    if (state.closing) {
      socket.destroy();
      return;
    }
    const req = incoming as UpgradeRequest;
    const response = new http.ServerResponse(incoming) as Response;
    try {
      response.assignSocket(socket as Socket);
    } catch {
      // A pipelined upgrade can arrive while the preceding HTTP response still
      // owns this socket. Reject the connection instead of crashing the worker.
      socket.destroy();
      return;
    }
    state.pending.add(socket as Socket);
    const onError = () => socket.destroy();
    socket.on('error', onError);
    const timer = setTimeout(() => {
      if (!response.headersSent)
        response.status(408).json({ error: 'WebSocket upgrade timed out' });
      socket.end();
    }, timeout);
    timer.unref();
    socket.once('close', () => {
      state.pending.delete(socket as Socket);
      clearTimeout(timer);
      socket.removeListener('error', onError);
    });
    const upgrade: Upgrade = {
      options,
      accepted: false,
      accept(handler, request, res) {
        if (upgrade.accepted || res.headersSent || socket.destroyed || state.closing) return;
        upgrade.accepted = true;
        clearTimeout(timer);
        wss.handleUpgrade(incoming, socket, head, (ws) => {
          state.pending.delete(socket as Socket);
          res.detachSocket(socket as Socket);
          res.statusCode = 101;
          res.emit('finish'); // Finish HTTP accounting and clear requestTimeout without writing HTTP bytes.
          socket.removeListener('error', onError);
          alive.add(ws);
          ws.on('pong', () => alive.add(ws));
          const context = {
            ...getRequestContext(),
            user: (request as Request & { user?: Record<string, unknown> }).user,
          };
          const emit = ws.emit;
          ws.emit = ((event: string | symbol, ...args: unknown[]) =>
            runWithContext({ ...context, queryCounts: new Map() }, () =>
              Reflect.apply(emit, ws, [event, ...args]),
            )) as typeof ws.emit;
          ws.on('error', (error) => getLogger().warn({ err: error }, 'WebSocket error'));
          const failed = (error: unknown) => {
            getLogger().error({ err: error }, 'WebSocket handler failed');
            ws.close(1011, 'Internal Server Error');
          };
          try {
            void Promise.resolve(
              runWithContext(context, () => {
                wss.emit('connection', ws, incoming);
                return handler(ws, request);
              }),
            ).catch(failed);
          } catch (error) {
            failed(error);
          }
        });
      },
    };
    req[UPGRADE] = upgrade;
    response.once('finish', () => {
      clearTimeout(timer);
      if (!upgrade.accepted) socket.end();
    });
    app(req, response);
  });
  // HTTP server.close() alone does not drain upgraded sockets.
  const close = server.close;
  server.close = function (callback?: (error?: Error) => void) {
    void closeWebSockets(server);
    return close.call(this, callback);
  };
  server.once('close', () => {
    state.stopHeartbeat();
  });
  return wss;
}

/** Close upgraded sockets with 1001, then terminate peers that do not acknowledge. */
export function closeWebSockets(server: http.Server, timeoutMs = 1000): Promise<void> {
  const state = servers.get(server);
  if (!state) return Promise.resolve();
  if (state.closing) return state.closing;
  state.stopHeartbeat();
  state.closing = new Promise<void>((resolve) => {
    for (const socket of state.pending) socket.destroy();
    state.pending.clear();
    const timer = setTimeout(() => {
      for (const client of state.wss.clients) client.terminate();
    }, timeoutMs);
    timer.unref();
    state.wss.close(() => {
      clearTimeout(timer);
      resolve();
    });
    for (const client of state.wss.clients) client.close(1001, 'Server shutting down');
  });
  return state.closing;
}
