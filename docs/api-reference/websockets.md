# WebSocket API (since 0.11.0)

```ts
import { attachWebSockets, closeWebSockets } from 'express-file-cluster';
import type { WebSocketHandler, WebSocketOptions } from 'express-file-cluster';
```

`WebSocketHandler = (socket: ws.WebSocket, request: express.Request) => void | Promise<void>`. Export it as `WS` from a route file. An invalid non-function `WS` export fails boot. File middleware runs before connection; `schema.WS` validates the HTTP handshake.

`attachWebSockets(server: http.Server, app: express.Express, options?: WebSocketOptions): ws.WebSocketServer` attaches upgrade handling once. Used automatically by ignite when WS routes exist, or explicitly with an EFC test app/custom server. It also integrates socket draining with `server.close()`.

`closeWebSockets(server: http.Server, timeoutMs = 1000): Promise<void>` sends 1001 and waits for clients to disconnect, terminating remaining peers at the deadline. Pending handshake sockets are destroyed immediately, including connections waiting in middleware. It is idempotent, and stops heartbeats. Calling it prevents further upgrades on that attachment.

| Option | Default | Behavior |
|---|---|---|
| `maxPayload?: number` | 1048576 | Integer inbound message byte limit from 1 through 2147483647. Compression is disabled. |
| `origins?: string[]` | same-origin | Exact HTTP(S) browser origins. Missing Origin is allowed; malformed/opaque origins are refused. |
| `heartbeatIntervalMs?: number` | 30000 | Integer ping/pong interval from 0 through 2147483647 ms; 0 disables. |
| `handshakeTimeoutMs?: number` | 10000 | Integer deadline from 1 through 2147483647 ms for upgrade middleware. |

`ignite({ websocket: false })` disables automatic attachment. No new import subpath is added. See [the guide](../guides/websockets.md) for middleware, authentication, async context, error handling, cluster boundaries and test cleanup.

Upgrades pipelined behind an unfinished HTTP response close the connection without throwing an uncaught socket-assignment error.
