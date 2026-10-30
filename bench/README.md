# Data-layer benchmarks

EFC's model APIs against the tools people would otherwise use, on the same tables / collections and the same data:

- **PostgreSQL:** EFC `defineTable` vs **Prisma 7** (node-postgres adapter) vs **Drizzle** (relational query API)
- **MongoDB:** EFC `defineCollection` vs **mongoose** (`lean()` reads — plain objects, which is what EFC returns)

EFC is booted through `ignite()`, the way an app runs it. This folder is not an npm workspace: it has its own lockfile, and nothing in it ships.

## Run

Needs PostgreSQL and MongoDB (defaults: `postgres://postgres@127.0.0.1:5433/efc_bench`, `mongodb://127.0.0.1:27017/efc_bench`; override with `BENCH_PG_URL` / `BENCH_MONGO_URL`) and a built framework (`npm run build` at the repo root).

```bash
cd bench
npm install
npx prisma generate && npx prisma db push   # Prisma's client and its tables
npm run bench                               # both engines
npm run bench -- --engine pg --iterations 5000 --rounds 9
npm test                                    # regression-gate validation
npm run bench -- --json results/latest.json --compare results/baseline.json --tolerance 10
```

## Method

- 200 users × 10 posts, seeded identically for every contender (raw SQL / driver inserts).
- Operations: find by id, a filtered + sorted + limited list, one user with their posts (`include` / `with` / `populate`), create, update (increment), count.
- Calls run one at a time (pool sizes don't matter), split into **rounds**; within a round the contenders alternate in a rotating order, and the **median round** is reported. On a laptop, single passes at sub-millisecond latencies varied by up to 2.4× between identical runs; interleaved rounds keep the *ratios* between contenders stable.
- `--compare` therefore checks EFC's ratio to the fastest contender in the same run against that ratio in the baseline (default tolerance 10%), not raw milliseconds — runner speed cancels out. The nightly workflow (`.github/workflows/bench.yml`) runs exactly this.

## Results

Node 22, PostgreSQL 18, MongoDB 8, a laptop — 3,500 calls per operation and contender in 7 rounds. Mean latency in ms (lower is better); **bold** = fastest.

| PostgreSQL | EFC | Prisma | Drizzle | EFC vs fastest |
|---|---:|---:|---:|---:|
| findUnique | **0.344** | 0.638 | 0.380 | fastest |
| findMany | 0.591 | 0.620 | **0.492** | 1.20× |
| include | **0.944** | 1.109 | 0.965 | fastest |
| create | 2.703 | 2.823 | **2.515** | 1.07× |
| update | 2.678 | 2.962 | **2.672** | 1.00× |
| count | 0.550 | 0.688 | **0.407** | 1.35× |

| MongoDB | EFC | mongoose (lean) | EFC vs fastest |
|---|---:|---:|---:|
| findById | **0.507** | 0.553 | fastest |
| find | 0.981 | **0.751** | 1.31× |
| populate | 1.367 | **1.238** | 1.10× |
| create | 0.620 | **0.546** | 1.14× |
| update | 0.535 | **0.416** | 1.29× |
| count | 2.176 | **2.128** | 1.02× |

Consistent across runs: EFC is ahead of Prisma on every PostgreSQL operation and level with Drizzle (which it runs on) except `count` (~1.3×). On MongoDB it's level with mongoose except list `find` and `update` (~1.3×) — likely EFC's record conversion (BSON → plain values, `id`) and update validation, though that isn't profiled yet. These are the first places to optimise; the baseline in `results/baseline.json` is what the nightly run holds EFC to.

## Regression gate and prepared statements

The nightly job explicitly enforces **10%**, matching M6. It fails on missing operations/contenders, empty output or nonpositive/nonfinite timings; a partial `--engine` run must still cover every baseline operation/contender for that engine. `npm test` checks the exact 10% boundary, slowdown, coverage failures and single-engine comparisons. Baselines are measurement artifacts; never overwrite one just to make a failing run pass.

The checked-in table/baseline above predates automatic prepared statements. Current EFC PostgreSQL runs use the default bounded preparation budget. Results may differ; the old baseline remains the comparison target until a deliberate, measured baseline update. M6 also includes bounded opt-in query metrics, query logs/slow-query/N+1 tests, editable model-backed studio tests, driver pool settings, and live prepared-statement reuse/transaction/invalidation tests.

The default/nightly sample is 5,000 measured calls plus 1,000 warmup calls per operation and contender, split exactly across 11 rotating rounds. Zero warmup is honored and rounds cannot exceed iterations. Shorter validation runs showed >10% variance on MongoDB `findById`, so the nightly sample/warmup was increased; the 10% threshold and checked-in baseline were not relaxed. Treat alerts as a reason to investigate, not permission to rebaseline automatically.

[M6 completion measurements (2026-10-30)](results/m6-validation.md) include all twelve operations, raw results, exact sampling settings, and the unchanged-baseline comparison.
