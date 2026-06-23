# Environment Variables

EFC reads configuration from environment variables so runtime secrets never appear in source code. The scaffolder generates two files: `.env` (gitignored, secrets pre-filled) and `.env.example` (committed, documented placeholders).

---

## Variable reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | HTTP listen port |
| `NODE_ENV` | No | — | `development \| production \| test`. Drives clustering, `Secure` cookie flag, source maps. |
| `DATABASE_URL` | Yes (if using a database) | — | Connection string. Format determines the engine: `mongodb://...` or `postgres://...` |
| `JWT_SECRET` | Yes (if using auth) | — | JWT signing secret (HS256). Generate with `openssl rand -hex 64`. |
| `JWT_EXPIRES_IN` | No | `7d` | Token lifetime. Accepts `15m`, `1h`, `7d`, `30d`, etc. |
| `COOKIE_DOMAIN` | No | — | Cookie domain for `http-only` auth strategy. Blank for localhost. |
| `REDIS_URL` | If tasks use BullMQ | `redis://localhost:6379` | Redis connection string for the BullMQ task queue. |
| `CORS_ORIGINS` | No | (all allowed) | Comma-separated list of allowed CORS origins. Example: `http://localhost:3000,https://myapp.com` |

---

## Precedence

`ignite()` options override environment variables. Environment variables override built-in defaults.

```ts
ignite({
  port: 8080,                        // wins over PORT env var
  jwtSecret: process.env.JWT_SECRET, // typical: pass through explicitly
});
```

When you omit an option from `ignite()`, EFC reads the env var directly:

```ts
ignite({ apiDir: '...' });
// PORT, DATABASE_URL, JWT_SECRET, CORS_ORIGINS — all read from process.env automatically
```

---

## Secret hygiene

- **Never commit `.env`.** The scaffolder adds it to `.gitignore` automatically.
- **Use a different `JWT_SECRET` per environment** (dev, staging, production). Rotating the secret invalidates all existing tokens.
- **Regenerate if exposed:**

  ```bash
  openssl rand -hex 64
  ```

  Paste the output into your `.env` and your deployment platform's secret store.

- **Do not log secrets.** EFC never echoes `JWT_SECRET` or `REDIS_URL` to stdout.

---

## `.env` vs `efc.config.ts`

| File | Purpose | Committed? |
|---|---|---|
| `.env` | Runtime secrets and per-environment overrides | **No** |
| `.env.example` | Documented template of every required variable | Yes |
| `efc.config.ts` | Structural configuration (directories, strategy, backend choice) | Yes |

Runtime values (`PORT`, `DATABASE_URL`, `JWT_SECRET`, `REDIS_URL`) belong in `.env`. Structural choices (`apiDir`, `authStrategy`, `tasks.backend`) belong in `efc.config.ts`.

---

## Development `.env` example

```bash
PORT=3000
NODE_ENV=development

DATABASE_URL=mongodb://localhost:27017/my-api-dev

JWT_SECRET=<generated-by-scaffolder>
JWT_EXPIRES_IN=7d

REDIS_URL=redis://localhost:6379

CORS_ORIGINS=http://localhost:5173
```

---

## Loading in development

In development (`efc start dev`), the CLI reads `.env` from the project root and injects variables into `process.env` before launching the app. Variables already present in `process.env` take precedence (so CI-injected vars are not overwritten).

In production (`efc start prod`), `.env` is **not** loaded. Platforms (Docker, Kubernetes, Railway, Heroku) inject secrets directly into `process.env`. This is intentional — avoid reading secret files from disk in production.
