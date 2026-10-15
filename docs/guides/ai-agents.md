# AI Coding Agents

EFC's API is newer than most models' training data, so an agent writing EFC code from memory will
invent imports, options and methods. EFC ships its documentation where agents can read it.

---

## Docs inside the package

Every release of `express-file-cluster` carries its own docs:

```
node_modules/express-file-cluster/dist/docs/
├── index.md, getting-started/, core-concepts/, guides/, api-reference/, cli/
└── skills/      ← dense reference cards: api-surface, routing-rules, what-not-to-invent, …
```

They always match the installed version. Apps created with `create-efc-app` include an
**`AGENTS.md`** that tells agents (Claude Code, Codex, Cursor, Copilot, …) to read these first.
For an existing app, copy the idea: point your agent at `skills/api-surface.md`,
`skills/what-not-to-invent.md` and the guide for the task at hand.

---

## MCP server

`express-file-cluster-mcp` serves the same docs over the
[Model Context Protocol](https://modelcontextprotocol.io), with search and scaffolding tools:

```bash
claude mcp add efc -- npx -y express-file-cluster-mcp
```

Other clients:

```json
{ "mcpServers": { "efc": { "command": "npx", "args": ["-y", "express-file-cluster-mcp"] } } }
```

| Tool | Use |
|---|---|
| `get-rules` | the public API, valid import paths, things that don't exist — call first |
| `list-docs` / `get-doc` / `search-docs` | find and read pages |
| `resolve-route` | route file → URL pattern |
| `scaffold-route` / `scaffold-task` | generate files that follow the conventions |

Pages are also resources (`efc://docs/guides/database`, …), and prompts such as `efc-model` and
`efc-debug` point the agent at the pages that answer them.
