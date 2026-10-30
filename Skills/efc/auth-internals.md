# EFC — Auth Internals (Exact)

Source: `packages/core/src/auth/index.ts`

---

## Configuration (happens in Pre-Flight)

```ts
// Called by ignite() at Pre-Flight step 2
configureAuth({
  secret: jwtSecret,
  strategy: authStrategy,          // 'http-only' | 'bearer' ('localStorage' = old name); anything else = bearer + startup warning (error in 1.0)
  expiresIn: JWT_EXPIRES_IN ?? '7d',
  cookieDomain: COOKIE_DOMAIN,     // optional
})
```

`_config` is a module-level singleton. All auth functions throw `'[EFC] Auth not configured — pass jwtSecret to ignite()'` if called before `configureAuth`.

---

## `issueToken(res, payload)`

```ts
// Signs JWT (HS256). bearer → `return token` (no cookie). http-only → sets the cookie, returns undefined
const token = await new SignJWT(payload)
  .setProtectedHeader({ alg: 'HS256' })
  .setExpirationTime(expiresIn)
  .sign(new TextEncoder().encode(secret))

res.cookie('efc_token', token, {
  httpOnly: true,
  secure: process.env['NODE_ENV'] === 'production',
  sameSite: 'strict',
  ...(cookieDomain && { domain: cookieDomain }),
})
```

Cookie name: exactly `'efc_token'` (hardcoded).
`secure` is only set in production. In dev, the cookie is sent over HTTP.
**Does NOT set `path` explicitly** — defaults to `/`.
**Does NOT set `maxAge` or `expires`** — cookie is session-scoped (expires when browser closes), but the JWT itself has an expiry enforced server-side by `jwtVerify`.

---

## `revokeToken(res)`

```ts
res.clearCookie('efc_token')
```

That's the entire implementation. Clears the cookie. The JWT itself is not invalidated — use `revokeSession` for that.

---

## Generated account-security routes

`change-password` checks nonempty string inputs and the authenticated account's current password, hashes and persists the replacement, clears its stored refresh token and expiry, then calls `revokeAllSessions`. Both User and Admin accounts are supported. Success signs out existing access and refresh tokens, including the current access token; revocation errors propagate rather than reporting success. This is generated app code, not a new core auth API.

Generated 2FA is app code (`src/lib/two-factor` + routes), not a new core API. Init / `efc add account-security` asks `TWO_FACTOR_METHOD=totp|email|both`; init adds email-client/SMTP prompts for email/both. Users and admins enroll one allowed method. `POST /auth/2fa/setup` with `{ password, method }` starts enrollment (TOTP returns a Base32 secret + otpauthUrl, email returns 202 and queues a code); `{ password, method, code }` confirms. GET returns status/allowed methods only. Confirmation clears refresh credentials and calls `revokeAllSessions`. TOTP: RFC 6238 SHA-1, six digits, 30s ±1, atomic last-step comparison. Email: random six digits, 5m expiry, HMAC digest bound to purpose/account/address, atomic consume. Active/pending TOTP secrets use AES-256-GCM with account identity as AAD and independent 64-hex `TWO_FACTOR_KEY`. Strip active/pending secret, email hash/expiry/purpose and last-step fields from records.

Login and `/auth/2fa/verify` share the full password+factor flow and one account rate-limit bucket (10/15m, cache errors reject). No tokens until the factor succeeds; email without code sends only after password verification. Disable needs authentication + password + a fresh code (email without code requests a disable code), erases secrets, and revokes access/refresh tokens. Refresh rotation compare-and-sets old token + enabled state. OAuth rejects 2FA-enabled accounts (use password+code); password reset preserves 2FA. No recovery codes. Device-session list/revoke remain authenticated **501** extension points.

## Session revocation (`revokeSession`, `revokeAllSessions`) — needs `cache`

Every signed token now carries `jti` (randomUUID), `iat`, and `efc_iat` (ms) — via the shared `sign()` used by
both `issueToken` and `signToken`.

- `revokeSession(req, res?)`: verifies the request's token, sets cache key `sess:jti:<jti>` with TTL = `exp - now`;
  clears the cookie when `res` is given and strategy is http-only. Throws if no cache / cache unreachable.
- `revokeAllSessions(userId)`: sets `sess:user:<id>` = `Date.now()` with TTL = `jwtExpiresIn` in seconds.
- `requireAuth` (only when a cache is configured): after `jwtVerify`, rejects with 401 if `sess:jti:<jti>` exists,
  or if `efc_iat` (fallback `iat*1000`) < the user's cutoff. User id = `payload.sub ?? payload.id`.
  If the cache read throws → `cache.onRevocationCheckError`: `'reject'` (default) → **503**
  `{ error: 'Service Unavailable', statusCode: 503 }`; `'allow'` → request passes. Logged at most every 30 s.

---

## `signToken(payload)`

```ts
// Signs JWT, returns string (no cookie)
return await new SignJWT(payload)
  .setProtectedHeader({ alg: 'HS256' })
  .setExpirationTime(expiresIn)
  .sign(new TextEncoder().encode(secret))
```

No `res` argument. Token must be sent in the response body by the route handler.

---

## `requireAuth` — middleware internals

`requireAuth` is dual-purpose, dispatched at runtime on the first argument:

```ts
// Bare — Express calls it as (req, res, next). First arg is an object → auth-only path.
export const middlewares = [requireAuth];

// Role-checked — called by user code with string args first, returns a new
// RequestHandler that Express later invokes as (req, res, next).
export const middlewares = [requireAuth('admin')];          // any of these roles
export const middlewares = [requireAuth('user', 'admin')];  // multiple allowed
```

```ts
// Strategy 'http-only': reads req.cookies.efc_token
// Strategy 'bearer' / 'localStorage': reads Authorization header → strips 'Bearer '

if (!token) → res.status(401).json({ error: 'Unauthorized' }); return

const { payload } = await jwtVerify(token, new TextEncoder().encode(secret))

// only when called with role names:
if (roles.length > 0 && !roles.includes(payload.role)) →
  res.status(403).json({ error: 'Forbidden' }); return

(req as any).user = payload   // ← attaches to req.user
next()
```

On any auth error (expired, invalid signature, malformed, missing token): catches and returns `{ error: 'Unauthorized' }` with status 401. A role mismatch returns `{ error: 'Forbidden' }` with status 403 instead. **Does NOT call next(err)** in either case — it handles the response itself and returns.

`req.user` is typed as `unknown` in the source. Cast to your payload type or use `(req as any).user`.

---

## JWT library

Uses `jose` (not `jsonwebtoken`). Key is UTF-8 encoded via `new TextEncoder().encode(secret)` before every call — no pre-computed key object is cached between requests.

---

## Token expiry

`expiresIn` is passed into `configureAuth` as a plain string by `ignite()` (`config.jwtExpiresIn ?? '7d'`) — `configureAuth` itself never touches `process.env`. All tokens issued in the same process lifetime use the same expiry value.

Format accepted by `jose`: `'15m'`, `'1h'`, `'7d'`, `'30d'`, integer seconds, etc.

---

## What auth does NOT do

- No refresh tokens in the framework itself (the scaffolder can generate an app-level `/auth/refresh` route backed by a DB-stored token — that's app code, not a core export).
- No revocation without a `cache` configured (then `revokeToken` just clears the cookie and a copied token stays valid until it expires). With a cache: `revokeSession` / `revokeAllSessions`.
- No CSRF token — relies on `SameSite: Strict` for http-only strategy.
- No multi-strategy per-route override — `authStrategy` is global, set once in `ignite()`.


Generated User/Admin logout requires authentication, compare-and-sets the account's stored refresh token to empty (including bearer logout with no refresh cookie/body), then revokes the current access token and clears cookies. Login persists refresh credentials only while the password hash still matches its verified snapshot. Generated login/refresh tokens carry `efc_auth_at`, captured before credential reads; revocation rejects a token whose authentication started at or before the cutoff, even if it was signed afterwards. Custom token issuers may include this numeric epoch-millisecond claim for the same protection; it can only restrict access, never override a later server-issued time. Existing generated apps must update their owned auth routes as well as the framework to receive these fixes.
