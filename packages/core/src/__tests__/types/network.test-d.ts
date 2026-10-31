import type http from 'node:http';
import type express from 'express';
import { z } from 'zod';
import {
  generateOpenAPI,
  attachWebSockets,
  closeWebSockets,
  type EFCConfig,
  type WebSocketHandler,
  type OpenAPIDocument,
  type RouteSchema,
} from '../../index.js';

declare const server: http.Server;
declare const app: express.Express;
const WS: WebSocketHandler = async (socket, request) => {
  socket.on('message', (data, binary) => socket.send(binary ? data : String(request.params.room)));
};
const config: EFCConfig = {
  tracing: { http: true, tasks: true, shutdown: async () => {} },
  openapi: {
    info: { title: 'API', version: '1' },
    schemaToJSONSchema: async () => ({ type: 'object' }),
  },
  websocket: { origins: ['https://app.example.com'], maxPayload: 1024 },
};
const schema: RouteSchema = { WS: { query: z.object({ room: z.string() }) } };
const doc: Promise<OpenAPIDocument> = generateOpenAPI('/tmp/api', { basePath: '/v2' });
const sockets = attachWebSockets(server, app);
sockets.clients.forEach((socket) => socket.close());
const closed: Promise<void> = closeWebSockets(server);
void [WS, config, schema, doc, closed];
const invalid: EFCConfig = {
  websocket: {
    // @ts-expect-error Payload limits must be numeric.
    maxPayload: 'large',
  },
};
void invalid;

const invalidTracing: EFCConfig = {
  tracing: {
    // @ts-expect-error Shutdown must return a Promise.
    shutdown: () => 123,
  },
};
void invalidTracing;
