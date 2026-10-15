#!/usr/bin/env node
// stdio entry point: `npx express-file-cluster-mcp` (or the `efc-mcp` bin).
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

await createServer().connect(new StdioServerTransport());
