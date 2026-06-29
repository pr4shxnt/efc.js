/**
 * EFC MCP Prompts
 *
 * Reusable prompt templates that an AI client can surface to guide
 * the user through common EFC development workflows.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function prompts(server: McpServer): void {
  // ─── 1. New project setup guide ───────────────────────────────────────────
  server.prompt(
    'efc-new-project',
    'Step-by-step guide for scaffolding a new EFC project.',
    {
      projectName: z.string().describe('Name of your new project directory.'),
    },
    ({ projectName }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Walk me through creating a new EFC project called "${projectName}". Cover:
1. Running the scaffolder
2. Project structure overview
3. Starting the dev server
4. Creating my first route`,
          },
        },
      ],
    }),
  );

  // ─── 2. Route implementation guide ────────────────────────────────────────
  server.prompt(
    'efc-route-guide',
    'Guide for implementing an EFC API route with best practices.',
    {
      resource: z.string().describe('Resource name, e.g. "users", "posts"'),
      methods: z.string().describe('Comma-separated HTTP methods, e.g. "GET,POST,DELETE"'),
    },
    ({ resource, methods }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Help me implement a complete EFC route for the "${resource}" resource supporting ${methods} methods. Include:
- Correct file placement in src/api/
- Proper handler exports
- Error handling with HttpError
- Example request/response shape`,
          },
        },
      ],
    }),
  );

  // ─── 3. Auth integration guide ────────────────────────────────────────────
  server.prompt(
    'efc-auth-guide',
    'Guide for integrating authentication into an EFC project.',
    {
      strategy: z.enum(['http-only', 'localStorage']).describe('Auth strategy to use.'),
    },
    ({ strategy }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Explain how to implement the "${strategy}" authentication strategy in EFC. Cover:
- ignite() configuration
- Login and logout route handlers
- Protecting routes with middlewares = [requireAuth]
- Environment variables needed`,
          },
        },
      ],
    }),
  );

  // ─── 4. Background task guide ─────────────────────────────────────────────
  server.prompt(
    'efc-task-guide',
    'Guide for defining and enqueuing EFC background tasks.',
    {
      taskName: z.string().describe('Name of the background task, e.g. SendEmail'),
      isCpuBound: z
        .enum(['yes', 'no'])
        .default('no')
        .describe('Is this task CPU-intensive (should use worker_threads)?'),
    },
    ({ taskName, isCpuBound }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Help me implement the "${taskName}" background task in EFC. The task ${isCpuBound === 'yes' ? 'IS CPU-bound and should run in worker_threads' : 'is NOT CPU-bound'}. Cover:
- defineTask usage with proper TypeScript types
- Payload interface design
- Enqueueing from a route handler
- Error handling and retries`,
          },
        },
      ],
    }),
  );

  // ─── 5. Debugging guide ───────────────────────────────────────────────────
  server.prompt(
    'efc-debug-guide',
    'Troubleshooting guide for common EFC issues.',
    {
      issue: z
        .enum(['routes-not-found', 'auth-failing', 'cluster-crash', 'task-not-running', 'env-vars'])
        .describe('Type of issue to debug.'),
    },
    ({ issue }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `I'm having a "${issue}" issue in my EFC project. Walk me through diagnosing and fixing it. Suggest relevant efc doctor checks and configuration to verify.`,
          },
        },
      ],
    }),
  );
}
