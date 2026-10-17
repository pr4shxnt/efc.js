# express-file-cluster-mcp

An [MCP](https://modelcontextprotocol.io) server that gives AI coding agents the
**express-file-cluster (EFC)** documentation, ground rules and scaffolding tools — so they
read the real API instead of guessing it.

The same docs, for people: [efc.prashantadhikari7.com.np/docs.html](https://efc.prashantadhikari7.com.np/docs.html).

The docs are bundled into the package at build time (`dist/docs`), so the server always serves
the documentation of the version you installed. Transport: stdio.

## Install

**Claude Code**

```bash
claude mcp add efc -- npx -y express-file-cluster-mcp
```

**Claude Desktop / Cursor / Windsurf / any MCP client**

```json
{
  "mcpServers": {
    "efc": { "command": "npx", "args": ["-y", "express-file-cluster-mcp"] }
  }
}
```

Pin it to your app's EFC version with `npm install -D express-file-cluster-mcp@<version>` and
use `"args": ["efc-mcp"]` (or `npx efc-mcp`).

## Tools

| Tool | What it does |
|---|---|
| `get-rules` | **Call first.** The exact public API, the three valid import paths and the list of things that don't exist. |
| `list-docs` | Every docs page: id, title, summary. |
| `get-doc` | One page in full, by id (`guides/database`, `api-reference/ignite`, `skills/routing-rules`, …). |
| `search-docs` | Ranked full-text search with snippets. |
| `resolve-route` | Route file → URL pattern (`[id]`, `[[id]]`, `[...slug]`, `[[...slug]]`, `index`, `basePath`). |
| `scaffold-route` | A route file: handlers, `requireAuth` / `requireAuth('role')`, validation `schema`. |
| `scaffold-task` | A task file: payload type, `thread`, `retries`, cron `schedule` / `timezone`. |

## Resources

Every page is also an MCP resource, `efc://docs/<id>` (markdown) — the guides, the API
reference, the CLI reference and the dense reference cards under `efc://docs/skills/…`.

## Prompts

`efc-new-project`, `efc-route`, `efc-model`, `efc-task`, `efc-auth`, `efc-debug`,
`efc-migrate-express` — each points the agent at the pages that answer it.

## Programmatic use

```ts
import { createServer } from 'express-file-cluster-mcp';
const server = createServer();          // McpServer — connect any transport
```

## Without MCP

The same docs ship inside the framework itself: `node_modules/express-file-cluster/dist/docs/`.
Apps created with `create-efc-app` include an `AGENTS.md` that points agents there.
