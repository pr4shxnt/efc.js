# M6 validation — 2026-10-30

M6 is complete: query logs/slow/N+1 detection, bounded opt-in per-process query metrics,
editable model-backed studio, pool configuration, bounded PostgreSQL prepared statements,
and a strict nightly 10% ratio regression gate.

Validation: lint, typecheck and build passed; **458 tests passed, 36 skipped** with live
MongoDB replica set, PostgreSQL and Redis. The five benchmark-harness tests passed.
The additional opt-in scaffold/install e2e suite passed all **32 tests**.
The local release rehearsal passed on Node v22.23.2: TypeScript MongoDB, TypeScript
PostgreSQL and JavaScript PostgreSQL apps completed dev/auth/migrate/sync/build/production
journeys through the installed CLI. Packaged MCP startup, 53 resources and seven tools
passed too. The interrupted rehearsal was resumed for the remaining PostgreSQL/JavaScript
and MCP checks using the same disposable registry and isolated databases. No public npm
publish was performed. Node 24 remains covered by the CI matrix, not this local run.

Prepared-statement tests cover reuse across parameter values, transactions/rollback,
per-connection limits, opt-out, schema-sync invalidation, query config preservation and
connection-error release. Metrics tests cover both live engines, failures, bounded
cardinality, snapshots, reset and privacy. Studio and logging/pool integration suites pass.

Benchmark: Node v22.23.2, **5000 measured calls + 1000 warmup per operation and contender,
11 rotating rounds**. PostgreSQL: EFC/Prisma/Drizzle; MongoDB: EFC/mongoose.
[Raw results](m6-validation.json). [Unchanged comparison baseline](baseline.json).

```sh
cd bench
npm test
npm run bench -- --iterations 5000 --rounds 11 --warmup 1000 --json results/latest.json --compare results/baseline.json --tolerance 10
```

All twelve operations pass. Ratios are EFC latency / fastest contender in each run;
changes compare those ratios, not raw times from different machine conditions.

| Engine | Operation | EFC mean (ms) | Baseline ratio | Validation ratio | Change |
|---|---|---:|---:|---:|---:|
| postgresql | findUnique | 0.537 | 1.000 | 1.000 | +0.0% |
| postgresql | findMany | 0.696 | 1.202 | 1.000 | -16.8% |
| postgresql | include | 0.881 | 1.000 | 1.000 | +0.0% |
| postgresql | create | 0.545 | 1.075 | 1.000 | -7.0% |
| postgresql | update | 0.636 | 1.002 | 1.000 | -0.2% |
| postgresql | count | 0.759 | 1.350 | 1.000 | -25.9% |
| mongodb | findById | 1.053 | 1.000 | 1.009 | +0.9% |
| mongodb | find | 1.631 | 1.306 | 1.104 | -15.5% |
| mongodb | populate | 2.495 | 1.104 | 1.105 | +0.1% |
| mongodb | create | 2.069 | 1.135 | 1.065 | -6.1% |
| mongodb | update | 2.343 | 1.288 | 1.112 | -13.7% |
| mongodb | count | 3.451 | 1.022 | 1.000 | -2.2% |

A shorter 3,500-call/9-round/200-warmup repeat flagged MongoDB findById at 14%.
The default/nightly sample was increased and exact round/warmup allocation was tested;
the 10% gate and baseline were not relaxed or automatically retried/rebaselined.
This is a single-host validation, not a guarantee of noise-free timings on every runner.

Remaining Phase 3 work (OpenAPI, OpenTelemetry, plugins, WebSockets, runtime dashboard,
release audit/readiness) is separate from M6. Phase 4 is tentative post-v1.0 growth.

Post-review security/testing regressions (2026-10-30): fixed DB refresh-token
invalidation on logout, password-snapshot/authentication-time guards for in-flight
login revocation, and the native-import CommonJS testing bridge. Lint, typecheck and
build passed; the full live-service suite with opt-in scaffold/install e2e passed
**507 tests (4 skipped), 51 files**. The benchmark measurements above are unchanged.
