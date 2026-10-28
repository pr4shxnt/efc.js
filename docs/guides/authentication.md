# Authentication Guide

EFC ships a complete JWT authentication system. Choose between two delivery strategies depending on who your clients are.

> Ready-made routes: `efc add auth` (register / login / logout / me) and `efc add auth@google` / `auth@apple` ([Sign in with Google & Apple](./oauth.md)). See [efc add](../cli/add.md).

---

## Choosing a strategy

The question is **who the client is**, not "website or app":

| | `http-only` (default) | `bearer` |
|---|---|---|
| **For** | Browsers — websites **and** SPAs (React, Vue, …) | Mobile / desktop apps, CLIs, server-to-server API clients |
| **Token travels as** | `HttpOnly` cookie | `Authorization: Bearer <token>` header |
| **Client stores it in** | Nothing — the browser handles the cookie | iOS Keychain / Android Keystore / OS credential store |
| **XSS** | Script can't read the token | A token kept in browser `localStorage` can be stolen by any script on the page |
| **CSRF** | Mitigated by `SameSite=Strict` | Not applicable (no cookie) |
| **`requireAuth` reads** | `req.cookies.efc_token` | the `Authorization` header |

Pick `http-only` for anything that runs in a browser — including SPAs. `bearer` is for clients that have no cookie jar (native apps) or that call the API on behalf of something else. The one browser case for `bearer` is an SPA on a completely different site than the API, where cookies would need `SameSite=None` and credentialed CORS.

`create-efc-app` asks this up front; `efc add auth` asks it too and writes the answer to `efc.config`. To switch later, change one line — the generated routes work with both:

```ts
// efc.config.ts
authStrategy: 'http-only',   // or 'bearer'
```

> `'localStorage'` is the pre-0.9.4 name for `'bearer'` and still works. Any other value is treated as `'bearer'` and logs a warning at startup; from 1.0 it's an error.

---

## `http-only` strategy

### Login

```ts
// src/api/auth/login.ts
import type { Request, Response } from 'express';
import { HttpError } from 'express-file-cluster';
import { issueToken, verifyPassword } from 'express-file-cluster/auth';
import { User } from '../../model/User.js';

export const POST = async (req: Request, res: Response) => {
  const user = await User.findOne({ email: req.body.email });
  if (!user || !(await verifyPassword(req.body.password, user.passwordHash))) {
    throw new HttpError(401, 'Invalid credentials');
  }

  await issueToken(res, { sub: user.id, role: user.role });
  res.json({ message: 'Logged in' });
};
```

`user.passwordHash` holds a string from `hashPassword()` — see [Passwords](#passwords).

`issueToken` sets a cookie named `efc_token`:

```
Set-Cookie: efc_token=<jwt>; Path=/; HttpOnly; Secure; SameSite=Strict
```

In development (`NODE_ENV !== 'production'`), `Secure` is omitted so the cookie works over `http://localhost`.

### Logout

```ts
// src/api/auth/logout.ts
import type { Request, Response } from 'express';
import { requireAuth, revokeSession } from 'express-file-cluster/auth';

export const middlewares = [requireAuth];

export const POST = async (req: Request, res: Response) => {
  await revokeSession(req, res); // invalidates the token and clears the cookie
  res.json({ message: 'Logged out' });
};
```

`revokeSession` needs a `cache` in `ignite()` — projects from `create-efc-app` configure one (Redis when `REDIS_URL` is set, otherwise the in-memory store), and their logout and password-reset routes already revoke sessions. Without one, `revokeToken(res)` clears the cookie only — the token itself stays valid until it expires. `revokeAllSessions(userId)` logs a user out of every device. See [Caching & Sessions](./caching.md).

### Protecting routes

```ts
// src/api/profile.ts
import { requireAuth } from 'express-file-cluster/auth';

export const middlewares = [requireAuth];

export const GET = async (req, res) => {
  const user = (req as any).user; // decoded JWT payload
  res.json({ userId: user.sub, role: user.role });
};
```

---

## `bearer` strategy

### Login

`issueToken` hands the token back instead of setting a cookie, so the same route serves both strategies:

```ts
// src/api/auth/login.ts
import type { Request, Response } from 'express';
import { HttpError } from 'express-file-cluster';
import { issueToken, verifyPassword } from 'express-file-cluster/auth';
import { User } from '../../model/User.js';

export const POST = async (req: Request, res: Response) => {
  const user = await User.findOne({ email: req.body.email });
  if (!user || !(await verifyPassword(req.body.password, user.passwordHash))) {
    throw new HttpError(401, 'Invalid credentials');
  }

  // http-only: sets the cookie, returns undefined. bearer: returns the token.
  const token = await issueToken(res, { sub: user.id, role: user.role });
  res.json({ message: 'Logged in', ...(token ? { token } : {}) });
};
```

The scaffolded login and `/auth/refresh` routes also return `refreshToken` in bearer mode; post it back as `{ refreshToken }` to `/auth/refresh` for a new pair. Google/Apple sign-in never puts the JWT in a URL: it redirects to `OAUTH_SUCCESS_REDIRECT#code=<code>`, and the app (e.g. its `myapp://signed-in` link) posts `{ code }` to `/auth/oauth/exchange` for the token. The code works once, for 60 seconds — see [Sign in with Google & Apple](./oauth.md).

The client keeps the token in secure storage and sends it on every request:

```js
// React Native (expo-secure-store); on iOS/Android natively: Keychain / Keystore
const { token } = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }).then(r => r.json());
await SecureStore.setItemAsync('token', token);

await fetch(`${API}/profile`, {
  headers: { Authorization: `Bearer ${await SecureStore.getItemAsync('token')}` },
});
```

Avoid browser `localStorage` for the token — that's what `http-only` is for.

### Protecting routes

Identical to `http-only` — `requireAuth` reads from the correct source based on the configured strategy:

```ts
export const middlewares = [requireAuth];
```

---

## Custom token payload

The `payload` object you pass to `issueToken` or `signToken` becomes the JWT body. Standard JWT claims (`sub`, `iat`, `exp`, `iss`, `aud`) are valid; you can add any custom fields.

```ts
await issueToken(res, {
  sub: user.id,
  role: user.role,
  plan: user.subscriptionPlan,
  orgId: user.organizationId,
});
```

If you want route protection based on the `role` claim, pass role names to `requireAuth`: `requireAuth('admin')` verifies the token *and* checks `payload.role` is one of the given roles, returning `403 Forbidden` otherwise. See [RBAC](./rbac.md).

Access custom claims in protected handlers via `(req as any).user`:

```ts
export const GET = async (req, res) => {
  const { sub, role, plan } = (req as any).user;
  res.json({ sub, role, plan });
};
```

---

## Token lifetime

Set `JWT_EXPIRES_IN` in `.env`, then pass it through as `jwtExpiresIn: process.env.JWT_EXPIRES_IN` in `efc.config.ts` (`ignite()` never reads it directly). Default: `7d`.

```
JWT_EXPIRES_IN=15m   # short-lived — for high-security use cases
JWT_EXPIRES_IN=1h
JWT_EXPIRES_IN=7d    # default
JWT_EXPIRES_IN=30d
```

There is currently no refresh-token mechanism built into the framework itself. For long-lived sessions with short-lived tokens, implement a `/auth/refresh` route that issues a new token using the existing one as a credential — the `account-security` feature (`efc add account-security`) generates a working `POST /auth/refresh` route: it stores a rotating long-lived refresh token in the database and reads it from an `efc_refresh_token` cookie or the `refreshToken` body field (see [Generated Portals](./generated-portals.md)).

---

## Cookie domain

For multi-subdomain setups (e.g. `api.example.com` setting a cookie for `*.example.com`), set:

```
COOKIE_DOMAIN=.example.com
```

and pass it through as `cookieDomain: process.env.COOKIE_DOMAIN` in `efc.config.ts` — `ignite()` never reads `COOKIE_DOMAIN` itself.

---

## Custom auth entities

EFC ships with **User** and **Admin** as built-in principals (`efc add auth`). Many apps need additional authenticatable entities — a food delivery app might have `Merchant` and `DeliveryPartner`, a marketplace might have `Seller` and `Buyer`.

Use `efc add auth:` to scaffold a new entity with its own model and namespaced auth routes:

```bash
# Either syntax works:
efc add auth:merchant
efc add auth --entity merchant

# Multiple at once:
efc add auth:merchant auth:driver
```

### What gets generated

For `efc add auth:merchant`:

| File | Purpose |
|---|---|
| `src/model/Merchant.ts` | Model with name, email, password, role, isActive, tokens |
| `src/api/auth/merchant/register.ts` | `POST /auth/merchant/register` |
| `src/api/auth/merchant/login.ts` | `POST /auth/merchant/login` |
| `src/api/auth/merchant/logout.ts` | `POST /auth/merchant/logout` |
| `src/api/auth/merchant/me.ts` | `GET /auth/merchant/me` |

The generated code uses the same auth primitives (`issueToken`, `requireAuth`, `revokeSession`) as the built-in User/Admin. Each entity's JWT carries `role: 'merchant'` (or whatever the entity name is, lowercased).

### Protecting routes by entity

```ts
import { requireAuth } from 'express-file-cluster/auth';

// Only merchants can access this route:
export const middlewares = [requireAuth('merchant')];

// Merchants OR admins:
export const middlewares = [requireAuth('merchant', 'admin')];
```

### Customising the generated code

The files belong to you — they're copied into your `src/` just like `efc add auth`. Add fields to the model, change the registration flow, add email verification — it's your code.

> **Note:** The existing `/auth/login` and `/auth/register` routes are **not modified**. Each custom entity gets its own namespace (`/auth/<entity>/...`), so nothing breaks.

---

## Environment variables

| Variable | Wired into (via `efc.config.ts`) | Description |
|---|---|---|
| `JWT_SECRET` | `jwtSecret` | Signing key — must be set; generate with `openssl rand -hex 64` |
| `JWT_EXPIRES_IN` | `jwtExpiresIn` | Token lifetime — default `7d` |
| `COOKIE_DOMAIN` | `cookieDomain` | Cookie domain for `http-only` strategy |

`ignite()` doesn't read any of these from `process.env` itself — see the full [Environment Variables reference](./environment-variables.md) for how the scaffolded `efc.config.ts` wires them.

---

## Passwords

`express-file-cluster/auth` hashes passwords with scrypt from `node:crypto` — no `bcrypt`, no native
build step, nothing extra to install.

```ts
import { hashPassword, verifyPassword, passwordNeedsRehash } from 'express-file-cluster/auth';

const passwordHash = await hashPassword(req.body.password);          // on register / reset
const ok = await verifyPassword(req.body.password, user.passwordHash); // on login
if (ok && passwordNeedsRehash(user.passwordHash)) {
  await User.update(user.id, { passwordHash: await hashPassword(req.body.password) });
}
```

Hashes look like `scrypt$32768$8$1$<salt>$<key>`; the cost parameters are stored in each hash, so a
future default doesn't lock anyone out. Apps scaffolded before 0.9.2 stored **bcrypt** hashes, which
`verifyPassword` deliberately rejects (EFC carries no bcrypt code or dependency): those users reset
their password once — the reset route stores a scrypt hash. See the
[auth API reference](../api-reference/auth.md#hashpassword--verifypassword--passwordneedsrehash).
