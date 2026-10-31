# Production readiness & known risks

Status as of **v0.12.0 (beta, 2026-10-31)**. Review this file before every release and
remove items as they're fixed.

**Verdict:** suitable for MVPs, internal tools and early-stage products where the team can fix
issues itself. Not yet recommended, without your own review and load testing, for high-stakes
systems: payments, regulated data, heavy traffic. The target for "production-ready without
caveats" is 1.0.0.

---

## What it stands on

- Mature libraries do the heavy lifting: Express, mongoose, pg + Drizzle, BullMQ, pg-boss, pino
  and jose.
- About 600 unit, integration and end-to-end tests run against real MongoDB (standalone and replica
  set), PostgreSQL and Redis. End-to-end tests scaffold and run real apps, and CI covers both engines.
- Nightly benchmarks against Prisma, Drizzle and mongoose fail on a >10% relative regression.
- The data layer is safe by default. Sync never drops columns or rows, destructive schema changes
  need explicit flags (`--allow-drop`, `--tighten`), and tightening steps check rows first.
- Generated code (the registry and scaffolds) is copied into the app, so teams can read and fix it.

## Risks

### 1. Project maturity
- **Young.** Developed over a few months, with no known production deployments yet.
- **Maintenance.** Maintained by the author together with Claude and its agents. Development is
  fast and well tested, but no independent human team has reviewed or audited the code.
- **No independent security audit yet,** especially of the auth, session revocation and OAuth code.
  Internal reviews found and fixed real issues (0.9.6 auth input validation, 0.10.2 and 0.12.0
  session/cache hardening); an outside review is still needed.

### 2. New, little-used features
- The `efc add` registry, `efc db generate`, `efc db pull` and `efc import-prisma` (0.8–0.10),
  OpenAPI and WebSockets (0.11.0) and OpenTelemetry tracing (0.12.0) are tested, but nobody has
  used them in a real app yet.

### 3. API stability (0.x)
- Under semver, a 0.x minor release (0.10.0, 0.11.0, …) may contain breaking changes.
- `^0.12.0` only matches 0.12.x, so upgrades are deliberate. Read the changelog before each one.

### 4. Automatic schema changes on boot
- `autoSync` (on by default) alters tables and indexes when the app first uses a model. It's
  advisory-locked, so instances don't race, but changing live tables during a deploy is risky.

### 5. Known bugs and gaps
- **OAuth:** Google and Apple sign-in were never tested end to end with real credentials
  (Apple also needs an https domain).
- **Benchmarks cover the data layer only** (vs Prisma/Drizzle/mongoose). HTTP throughput under
  load is unmeasured against bare Express or Fastify.
- **Flaky test:** one `db-cli` integration test failed once in a full parallel run.
- **Prisma import:** rows in Prisma's implicit `_AToB` join tables aren't copied.

### 6. Setup limits
- The `memory` cache lives in one machine's primary process. Use `redis` for multiple instances
  (also needed for session revocation to work across them).
- MongoDB `transaction()` needs a replica set.
- `revokeToken` only clears the cookie. Real revocation (`revokeSession`, `revokeAllSessions`)
  needs `cache` configured.

## How to mitigate each risk

| # | Risk | Mitigation | Clears when |
|---|---|---|---|
| 1 | Young, no production users | Run it on our own apps first; publish the beta and gather real usage; keep the test suite green on every release | A few real apps run on it for weeks without incident |
| 1 | No independent/human audit | Commission or ask a security-minded human to review auth, sessions and OAuth; run `npm audit` and a SAST tool (e.g. CodeQL) in CI | A documented audit of the auth path exists |
| 2 | New, little-used features (registry, `db generate/pull`, import-prisma) | Keep the integration tests that exercise them on real databases; dogfood them in a scaffolded app each release | Used in a real app through at least one real schema change |
| 3 | 0.x breaking changes | Keep a CHANGELOG with a migration note per breaking change; pin exact versions in production; adopt semver strictly | 1.0.0 freezes the public API |
| 4 | `autoSync` alters tables on boot | Ship `autoSync: false` as the production default in scaffolds; make `efc db migrate` the documented deploy step; advisory lock already prevents races | Docs + scaffold default steer prod users off autoSync |
| 5 | OAuth never tested with real creds | One manual run through real Google and Apple on an https staging domain; document the result | Verified once end to end |
| 5 | No HTTP benchmarks | Add bench runs vs bare Express / Fastify next to the existing data-layer benchmarks | HTTP benchmarks in CI |
| 5 | Flaky `db-cli` test | Isolate its database per run (unique schema/db), or serialise it; reproduce and fix the race | Passes 50 consecutive full runs |
| 5 | Prisma `_AToB` rows not copied | Emit a data-copy migration step, or document the one-liner; already noted in the model comment | Copy step generated |
| 6 | `memory` cache is single-machine | Default scaffolds to Redis when `REDIS_URL` is set (already done); document the limit (done in RISKS) | — (documented) |
| 6 | Mongo transactions need a replica set | Detect a non-replica-set connection and warn at first `transaction()`; document it | Warning added |
| 6 | `revokeToken` only clears the cookie | Already documented; scaffolds use `revokeSession`; keep the 503-on-cache-down default | — (documented) |

## Recommended production setup

1. Pin the exact version: `"express-file-cluster": "0.12.0"`.
2. Set `autoSync: false`. Make schema changes with `efc db generate <name>`, review the file, and
   run `efc db migrate` as a release step.
3. In CI, run `efc db generate --verify` (migrations match the models) and
   `efc db sync --dry-run --exit-code` against staging (no drift).
4. Review the generated auth, billing and admin code as your own. Check cookie settings,
   `jwtSecret` strength and rate limiting.
5. Use Redis for `cache`, and use a replica set if you use MongoDB transactions.
6. Load-test your main endpoints before launch.
7. Make background tasks idempotent: an enqueue that times out may still have been
   accepted by the backend.

## Before 1.0.0

- [x] M5 `defineCollection` (MongoDB-native API + MongoDB `pull`) — 0.10.0
- [x] M6 benchmarks, editable studio and pool settings — 0.10.0/0.10.2
- [x] M7 docs ("Which API do I use?", "Coming from mongoose", feature matrix) — 0.10.0
- [x] Fix the `localStorage` login token — 0.9.4 (shipped in 0.9.6, `bearer` strategy)
- [ ] Security review of auth, sessions and OAuth (incl. a real Google/Apple sign-in)
- [ ] A few real apps running on it for a sustained period
- [ ] Fix the flaky `db-cli` test
