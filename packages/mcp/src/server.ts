/**
 * express-file-cluster-mcp — the EFC framework's documentation, ground rules and
 * scaffolding tools for AI coding agents, over the Model Context Protocol.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadDocs, type DocPage } from './docs.js';
import { registerTools } from './tools.js';
import { registerPrompts } from './prompts.js';

export { loadDocs, searchDocs, type DocPage } from './docs.js';
export { resolveRoute } from './tools.js';

function packageVersion(): string {
  const pkg = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  try {
    return (JSON.parse(fs.readFileSync(pkg, 'utf8')) as { version: string }).version;
  } catch {
    return '0.0.0';
  }
}

export function createServer(options: { docsDir?: string } = {}): McpServer {
  const pages: DocPage[] = loadDocs(options.docsDir);
  const server = new McpServer(
    { name: 'express-file-cluster', version: packageVersion() },
    {
      instructions:
        'Documentation for express-file-cluster (EFC), a backend framework on Express. Before writing EFC code call get-rules, then find pages with list-docs / search-docs and read them with get-doc. Never invent EFC APIs or import paths.',
    },
  );

  for (const page of pages) {
    server.registerResource(
      page.id,
      page.uri,
      { title: page.title, description: page.summary || page.title, mimeType: 'text/markdown' },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text: page.content }],
      }),
    );
  }
  registerTools(server, pages);
  registerPrompts(server);
  return server;
}
