# Versioning & Support Policy

`express-file-cluster`, `create-efc-app` and `express-file-cluster-mcp` are released together under one version number, following [Semantic Versioning](https://semver.org/).

## Before 1.0 (now: 0.x)

| Bump | Example | What it may contain |
|---|---|---|
| **Patch** | 0.9.4 → 0.9.5 | Bug fixes, security fixes, clearer errors, docs. No new public API. A fix can change behaviour that was wrong (e.g. a route that leaked data); the changelog says so and gives upgrade steps. |
| **Minor** | 0.9.x → 0.10.0 | New features and APIs. May include breaking changes — each one is listed in [`CHANGELOG.md`](https://github.com/pr4shxnt/efc.js/blob/main/CHANGELOG.md) with upgrade steps. |

Pin a minor range (`~0.9.5`) if you want fixes without features; `^0.9.5` behaves the same way on 0.x (npm treats the minor as the breaking digit).

Deprecations are announced at least one minor release before removal, with a startup warning where possible (e.g. an unknown `authStrategy` warns in 0.9.x and becomes an error in 1.0).

## From 1.0

- **Major** (1.x → 2.0): breaking changes only, each with upgrade steps.
- **Minor** (1.1 → 1.2): new features, backwards compatible.
- **Patch** (1.1.0 → 1.1.1): fixes and security fixes only.
- The three import paths (`express-file-cluster`, `/auth`, `/tasks`) and everything they export are the public API. Anything else — internal modules, generated file layouts, log message wording — can change in a minor.

## Long-term support (from 1.0)

| Line | Gets | For |
|---|---|---|
| **Current** major | Features, fixes, security fixes | Until the next major |
| **Previous** major | Security fixes and critical bug fixes | 12 months after the next major ships |

Before 1.0 only the latest 0.x minor gets fixes — upgrade to it to get them.

## Node.js

EFC supports the Node.js versions in **active or maintenance LTS** and is tested on **Node 22 and 24** in CI. A Node version that reaches end-of-life stops being supported in the next minor release. (`engines` still says `>=18`; it will be raised to the supported range at 1.0. Node 18 and 20 are end-of-life and untested — scaffolded apps' email client already needs Node 20+.)

## Generated code

`create-efc-app` and `efc add` copy source files into your app; after that the code is yours, and upgrading the framework doesn't change it. When a release fixes generated code, the changelog says which files and how — re-add an untouched file with `efc add <item>`, or a changed one with `efc add <item> --overwrite` (then reapply your edits), or apply the shown change by hand.

## Security

See [`SECURITY.md`](https://github.com/pr4shxnt/efc.js/blob/main/SECURITY.md) for how to report a vulnerability. Security fixes ship as patch releases and are marked **Security** in the changelog.
