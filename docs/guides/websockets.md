# File-based WebSockets (since 0.11.0)

Export `WS` from a route file. `ignite()` serves its upgrade on the same HTTP server and `basePath` as HTTP routes.

```ts
// src/api/chat/[room].ts
import type { WebSocketHandler } from 'express-file-cluster';
import { requireAuth, getCurrentUser } from 'express-file-cluster/auth';

export const middlewares = [requireAuth];
export const WS: WebSocketHandler = (socket, req) => {
  socket.on('message', (data, isBinary) => {
    const user = getCurrentUser();
    socket.send(JSON.stringify({ room: req.params.room, userId: user?.id, text: data.toString(), isBinary }));
  });
};
```

Connect to `ws://localhost:3000/v1/api/chat/general` (use `wss://` behind TLS). `WS` receives a [ws WebSocket](https://github.com/websockets/ws/blob/master/doc/ws.md) and the Express request. An HTTP `GET`/`POST` export can coexist in the same file. HTTP clients do not invoke `WS`, and upgrading an HTTP-only or unknown route returns 404.

Middleware response headers (including cookies and request IDs) are included in successful upgrades; protocol framing/negotiation headers remain owned by the WebSocket server. Global and file middleware, cookie parsing, request context and named/optional/catch-all params apply before upgrade. `requireAuth` checks cookies/bearer tokens and revocation during the handshake; auth failure is an HTTP 401/403/503 rather than a WebSocket connection. Use method-keyed `schema.WS` for query/params handshake validation. It does not validate message frames. `getCurrentUser()` and the request logger remain available in message/close/error callbacks and across awaits. Handle errors inside application event listeners; EFC catches errors thrown/rejected by the exported connection handler and closes with 1011.

Browser clients use cookies; the browser WebSocket API cannot set arbitrary Authorization headers. Authorization and session changes during an already established connection are application policy: recheck sensitive message operations or close affected sockets when sessions end. Handshake authentication is not repeated for every frame.

```ts
ignite({
  ...config,
  websocket: {
    origins: ['https://app.example.com'],
    maxPayload: 1024 * 1024,
    heartbeatIntervalMs: 30_000,
    handshakeTimeoutMs: 10_000,
  },
});
```

Upgrades are enabled when a `WS` export exists. `websocket: false` disables them. Browser origins default to same-origin using Express's protocol/host; configure `trustProxy` correctly behind a proxy. An explicit origin list replaces this default. Opaque/malformed/cross-origin handshakes are rejected with 403. Clients without an Origin header (such as trusted Node clients) are allowed and still pass auth middleware.

`maxPayload` accepts integers from 1 through 2147483647 bytes; larger values fail configuration instead of overflowing the receiver’s limit. Both timer options also have a 2147483647 ms ceiling. Inbound messages default to a 1 MiB limit, compression is disabled, and heartbeat pings terminate unresponsive peers. Set `heartbeatIntervalMs: 0` to disable heartbeat. Pending middleware has a 10-second upgrade deadline; the HTTP `requestTimeout` may reject it earlier. Once upgraded, HTTP request timers are cleared.

Pipelined upgrades received while an earlier HTTP response still owns the connection close that connection safely.

`server.close()` immediately destroys pending handshake sockets, closes established sockets with code 1001 and terminates unresponsive peers after a drain interval. `gracefulShutdown(server)` drains WebSockets with HTTP/task shutdown, including signals forwarded to workers. Every cluster worker owns its connections; broadcasts through a server's `clients` set stay within that worker. Use application pub/sub for cross-worker/instance messages.

## Testing and custom HTTP servers

```ts
import http from 'node:http';
import { attachWebSockets } from 'express-file-cluster';
import { createTestApp } from 'express-file-cluster/testing';

const app = await createTestApp({ apiDir: '/absolute/path/to/api' });
const server = http.createServer(app);
const sockets = attachWebSockets(server, app);
server.listen(0);
// Connect a ws client; sockets.clients contains this server's connections.
// Close server in cleanup; upgraded sockets are drained too.
```

The test helper itself still does not start a listener. `attachWebSockets` rejects duplicate attachment. Each server has its own limits, connections and heartbeat; app auth/cache state follows the process-wide isolation rules in the testing guide.
