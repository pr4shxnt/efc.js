/**
 * EFC Docs MCP Server
 *
 * Exposes the express-file-cluster (EFC) framework documentation as MCP
 * tools, resources, and prompts so any MCP-compatible AI client can query
 * the framework's API, routing rules, config options, CLI commands, and more.
 *
 * Transport: stdio (compatible with Claude Desktop, Cursor, Antigravity, etc.)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { docs } from './docs.js';
import { tools } from './tools.js';
import { prompts } from './prompts.js';

// ── Server bootstrap ─────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'efc-docs',
  version: '0.1.0',
});

// ── Register resources (static docs sections) ────────────────────────────────

for (const [uri, { name, description, content }] of Object.entries(docs)) {
  server.resource(name, uri, { description }, async () => ({
    contents: [{ uri, mimeType: 'text/plain', text: content }],
  }));
}

// ── Register tools ────────────────────────────────────────────────────────────

tools(server);

// ── Register prompts ─────────────────────────────────────────────────────────

prompts(server);

// ── Connect transport ─────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
