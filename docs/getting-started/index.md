# Getting Started

## Prerequisites

- Node.js 18 or later
- npm 9 or later
- (Optional) MongoDB or Redis if you need a database or background tasks

---

## Scaffold a new project

```bash
npx create-efc-app my-api
```

The interactive CLI asks five questions:

```
? Select Language:         TypeScript | JavaScript
? Select Database:         MongoDB | PostgreSQL
? Auth strategy:           http-only | localStorage
? Enable clustering?       yes | no
? Enable background tasks? yes | no
  → Queue backend:         BullMQ (Redis) | pg-boss (PostgreSQL)
```

After confirmation it:

1. Writes the full project tree (see [Project Structure](./project-structure.md)).
2. Creates `efc.config.ts` pre-configured for your choices.
3. Generates `.env` (gitignored, `JWT_SECRET` pre-filled with `openssl rand -hex 64`) and `.env.example` (committed, documented placeholders).
4. Adds `.env` to `.gitignore`.
5. Writes `package.json` lifecycle scripts (`dev`, `build`, `start`, `test`).
6. Runs `npm install` with the peer dependencies for your selections.

---

## Generated `package.json` scripts

| Script | Expands to | When to use |
|---|---|---|
| `npm run dev` | `efc start dev` | Local development — hot-reload, single process |
| `npm run build` | `efc build prod` | CI/CD — type-check + compile to `dist/` |
| `npm start` | `efc start prod` | Production — runs `dist/` with clustering |
| `npm test` | `efc run tests` | Test suite via Vitest |

---

## First run

```bash
cd my-api
npm run dev
# [EFC] Worker primary listening on :3000
```

The server is live at `http://localhost:3000`. The scaffolder creates a `src/api/health.ts` route at `/health` as a smoke test.

---

## Next steps

- [Project Structure](./project-structure.md) — understand every file the scaffolder created.
- [File-Based Routing](../core-concepts/file-based-routing.md) — learn the naming rules.
- [CLI Reference](../cli/index.md) — all `efc` commands.
