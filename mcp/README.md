# efc-docs-mcp

> MCP server that exposes the **express-file-cluster (EFC)** framework documentation as tools, resources, and prompts for any MCP-compatible AI client.

---

## What is MCP?

The **Model Context Protocol** (MCP) is an open standard that lets AI assistants (Claude, Cursor, Antigravity, etc.) connect to external tools and data sources in a structured way.

---

## Features

### Resources (10 docs sections)

| URI | Content |
|---|---|
| `efc://docs/overview` | Framework overview & quick start |
| `efc://docs/routing` | File-based routing rules |
| `efc://docs/middleware` | Three-tier middleware system |
| `efc://docs/ignite` | Full `ignite()` API reference |
| `efc://docs/auth` | Authentication strategies |
| `efc://docs/tasks` | Background task system |
| `efc://docs/cli` | CLI command reference |
| `efc://docs/clustering` | Multi-core clustering architecture |
| `efc://docs/errors` | Error handling & `HttpError` |
| `efc://docs/env` | Environment variables |

### Tools (12 tools)

| Tool | Description |
|---|---|
| `list-docs` | List all documentation sections |
| `get-doc-section` | Fetch a specific section by name |
| `resolve-route` | Convert file path → URL pattern |
| `scaffold-route` | Generate a route handler file |
| `scaffold-task` | Generate a background task file |
| `ignite-option` | Look up any `ignite()` option |
| `list-ignite-options` | List all `ignite()` options with types and defaults |
| `search-docs` | Full-text search across all docs |
| `generate-ignite-config` | Generate a configured `ignite()` snippet |
| `scaffold-middleware` | Generate a standalone middleware function |
| `check-common-mistakes` | Return known EFC gotchas and anti-patterns |
| `list-not-implemented` | List Phase 2+ features not yet implemented |

### Prompts (6 prompts)

| Prompt | Description |
|---|---|
| `efc-new-project` | New project scaffold guide |
| `efc-route-guide` | Route implementation guide |
| `efc-auth-guide` | Authentication integration guide |
| `efc-task-guide` | Background task guide |
| `efc-debug-guide` | Troubleshooting common issues |
| `efc-migration-guide` | Migrate an existing Express app to EFC |

---

## Setup

```bash
cd mcp
npm install
npm run build
```

## Run

```bash
npm start
# or with the MCP Inspector for debugging:
npm run inspector
```

## Claude Desktop Config

Add to `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "efc-docs": {
      "command": "node",
      "args": ["/absolute/path/to/temp-nodejs/mcp/dist/index.js"]
    }
  }
}
```

## Claude Code (CLI) Config

Run once to register permanently:

```bash
claude mcp add efc-docs node /absolute/path/to/temp-nodejs/mcp/dist/index.js
```

Or add manually to `~/.claude/claude_desktop_config.json` using the same format as above.

## Cursor / Antigravity Config

```json
{
  "mcpServers": {
    "efc-docs": {
      "command": "node",
      "args": ["./mcp/dist/index.js"]
    }
  }
}
```

---

## Transport

Uses **stdio** transport — the standard for local MCP servers. No network port required.
