# Caching & Sessions

`ignite({ cache })` gives you a key/value cache, response caching for GET routes, and the store `requireAuth` checks for **revoked sessions** — so logging out (or "log out everywhere") actually invalidates tokens.

---

## Configure

```ts
// efc.config.ts
const config: EFCConfig = {
  cache: { backend: 'redis', url: process.env.REDIS_URL },
};
```

| Option | Backend | Default | |
|---|---|---|---|
| `backend` | — | — | `'redis'` (shared by all workers and instances) or `'memory'` (shared by this machine's workers) |
| `url` | redis | `redis://localhost:6379` | `rediss://`, ACL users and `/db` supported |
| `prefix` | both | `'efc:'` | Key prefix, so several apps can share one Redis |
| `timeout` | redis | `1000` | Per-command ms before Redis counts as unavailable |
| `maxEntries` | memory | `10000` | Least-recently-used entries are evicted beyond this |
| `onRevocationCheckError` | both | `'reject'` | What `requireAuth` does if it can't reach the cache — see [outage behaviour](#outage-behaviour) |

Requires `ioredis` for the Redis backend (`npm install ioredis` — BullMQ already depends on it).

**Memory backend under clustering.** The store lives in the cluster primary and workers reach it over IPC, so every worker on the machine sees the same entries and the same revoked sessions. It is still one machine's memory: not shared between instances behind a load balancer, and emptied on restart (revoked tokens become valid again). Use Redis once you run more than one instance. If workers are started by your own cluster primary instead of `ignite()`'s, there's no EFC primary to answer; each worker then logs a warning and keeps its own store.

---

## The `cache` API

```ts
import { cache } from 'express-file-cluster';

await cache.set('user:42', user, { ttl: 300 });      // seconds; omit for no expiry
const hit = await cache.get<User>('user:42');        // undefined on a miss
await cache.has('user:42');
await cache.del('user:42', 'user:43');               // → number deleted
await cache.clear('user:');                          // every key with this prefix → number deleted

// Get-or-compute: concurrent callers in one process share a single computation
const stats = await cache.wrap('stats:daily', 60, () => Stats.aggregate(pipeline));

// Atomic counter — one count across every worker (and, on Redis, every instance)
const n = await cache.incr('signups:today', { ttl: 86_400 });  // TTL set when the key is created
```

Values are stored as JSON — `Date`s come back as ISO strings. `undefined` is never cached.

### When Redis is down

The cache **degrades instead of failing**: `get` returns `undefined`, `set`/`del` are no-ops, `wrap` just runs your function, `incr` returns `undefined` (a count can't be made up). Requests keep working (only slower), and a warning is logged at most every 30 seconds. Boot waits up to ~2 s for the first connection, then continues regardless.

---

## Rate limiting

```ts
import { rateLimit } from 'express-file-cluster';

// src/api/auth/login.ts
export const middlewares = [rateLimit({ window: '15m', max: 10 })];
```

`rateLimit` counts in the cache (`cache.incr`), so the limit is one limit for the whole app — an in-memory counter per worker would let 8 workers accept 8 × `max`. With the `memory` backend that's per machine; use `redis` when you run several instances.

| Option | Default | |
|---|---|---|
| `window` | — | Seconds, or `'30s'` / `'15m'` / `'1h'` / `'1d'`. Windows are aligned to the clock. |
| `max` | — | Requests per window and key. The next one gets **429** with `Retry-After`. |
| `key` | client IP (`req.ip`) | Who a request counts against; return `undefined` to not limit it. |
| `name` | the route pattern | Routes with the same `name` share a limit. |
| `onCacheError` | `'allow'` | Cache unreachable: let requests through, or `'reject'` with 503. |
| `headers` | `true` | `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`. |

**Behind a proxy or load balancer, set `trustProxy` in `ignite()`** (`TRUST_PROXY=1` in scaffolded apps). Otherwise `req.ip` is the proxy's for every client, and an IP-keyed limit is one limit for everyone. The login and forgot-password routes `create-efc-app` generates key on the email too (`10 / 15 min per address + account`, `5 reset emails / hour per address`), so even then they limit one account, never everyone:

```ts
rateLimit({ window: '15m', max: 10, key: (req) => `${req.ip}:${String(req.body?.email ?? '').toLowerCase()}` })
```

---

## Response caching

```ts
// src/api/products/index.ts
import { cacheResponse } from 'express-file-cluster';

export const middlewares = [cacheResponse(60)];   // seconds

export const GET = async (req, res) => {
  res.json(await Product.find({}, { sort: { name: 1 } }));
};
```

- Caches **200 JSON** responses of `GET`/`HEAD`; other methods and statuses pass through.
- Keyed by the full URL (path + query) — `?page=2` is a separate entry. Override with `key: (req) => …`.
- Adds `X-Cache: HIT` or `MISS`.
- Per-user data: put `requireAuth` first and use `perUser: true` — entries are keyed by the JWT's `sub`/`id`, and requests without a user skip the cache instead of sharing one.

```ts
export const middlewares = [requireAuth, cacheResponse({ ttl: 30, perUser: true })];
```

Invalidate after writes by prefix — cached responses live under `res:`:

```ts
export const POST = async (req, res) => {
  const product = await Product.create(req.body);
  await cache.clear('res:/v1/api/products');
  res.status(201).json(product);
};
```

---

## Session revocation

JWTs are stateless, so on their own a token stays valid until it expires — clearing the cookie doesn't help if the token was copied. With a cache configured, every token EFC signs carries a unique `jti`, and `requireAuth` checks a denylist:

```ts
import { requireAuth, revokeSession, revokeAllSessions } from 'express-file-cluster/auth';

// Log out this device: the current token is rejected from now until it would have expired.
export const middlewares = [requireAuth];
export const POST = async (req, res) => {
  await revokeSession(req, res);   // `res` also clears the cookie (http-only strategy)
  res.json({ ok: true });
};

// Log out everywhere / after a password change: every token issued to this user
// before now is rejected; tokens issued afterwards work.
await revokeAllSessions(user.id);  // the JWT's `sub` or `id` claim
```

Entries expire on their own once the tokens they cover would have expired (`jwtExpiresIn`), so the denylist never grows unbounded.

### Outage behaviour

If `requireAuth` can't reach the cache to check a token, `onRevocationCheckError` decides:

| Value | Authenticated requests during the outage | |
|---|---|---|
| `'reject'` (default) | **503** `{ "error": "Service Unavailable" }` | A revoked token can never slip through. 503 rather than 401, so clients don't discard tokens and force a re-login over a blip. |
| `'allow'` | pass through | Availability first — revocations made before the outage apply again once the cache is back. |

```ts
cache: { backend: 'redis', url: process.env.REDIS_URL, onRevocationCheckError: 'allow' },
```

Either way the failure is logged (at most every 30 seconds), and calling `revokeSession` / `revokeAllSessions` during an outage **throws**, so a failed logout is never reported as a success. Plain `cache.get/set` calls are unaffected — they degrade to misses.

`revokeToken(res)` still exists and only clears the cookie — prefer `revokeSession` when a cache is configured.

ESM and CommonJS imports share the configured backend, key prefix, pending cache fills and revocation failure policy within one process. A backend configured by one build is used by the other; closing it closes the shared backend. Use one application/cache configuration per process.

## Since 0.12.0 production hardening

`cache.wrap` recovers after synchronous throws and prevents old in-flight computations from populating a replacement cache namespace. Memory capacity must be a positive safe integer; bad configuration fails before replacing an existing store.

Response keys separate HTTP methods and encode string/numeric user identifiers without delimiter collisions. GET and HEAD cannot poison one another. URL-prefix invalidation remains supported. The cache stores completed, serialized JSON and safe representation headers. It honors `Vary` by checking hashed request-header fingerprints; differing variants are misses (a custom key can keep variants separately). Wildcard `Vary`, `no-store`/`no-cache`, `Set-Cookie` (including late cookies), and private responses without `perUser` are not stored. Per-request headers such as CORS, request IDs and cookies are not replayed from cached handler headers; set custom dynamic headers in middleware.

Memory cache eviction cannot discard protected auth revocations. If protected entries fill its capacity, new revocation writes reject visibly; ordinary cache writes degrade to misses. Per-user revocation cutoffs have no automatic expiry, protecting older tokens if `jwtExpiresIn` is shortened. Use a persistent Redis deployment with a no-eviction policy for production revocation durability; memory state is still lost on restart, and explicitly clearing session keys removes revocations.

IPC cache calls reject on shutdown/disconnection rather than hanging. Rate-limit windows must be finite, at least one millisecond, and safely representable; counter keys isolate route/key tuples even when their components contain colons.

Response-cache hits replay the exact serialized JSON bytes, preserving JSON replacer/escaping output without running the replacer a second time.
