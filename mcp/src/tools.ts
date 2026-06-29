/**
 * EFC MCP Tools
 *
 * Interactive tools an AI agent can call to query EFC documentation,
 * generate route/task/middleware scaffolds, look up ignite() options,
 * resolve file paths to URL patterns, and more.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { docs } from './docs.js';

// ── Utility ──────────────────────────────────────────────────────────────────

function sectionNames(): string[] {
  return Object.values(docs).map((d) => d.name);
}

function sectionByName(name: string) {
  return Object.values(docs).find((d) => d.name === name);
}

// ── Tool registry ─────────────────────────────────────────────────────────────

export function tools(server: McpServer): void {
  // ─── 1. List all documentation sections ──────────────────────────────────
  server.tool(
    'list-docs',
    'List all available EFC documentation sections.',
    {},
    async () => {
      const list = Object.entries(docs)
        .map(([uri, { name, description }]) => `• [${name}] ${description}\n  URI: ${uri}`)
        .join('\n\n');
      return { content: [{ type: 'text', text: `Available EFC documentation sections:\n\n${list}` }] };
    },
  );

  // ─── 2. Get a documentation section by name ───────────────────────────────
  server.tool(
    'get-doc-section',
    'Retrieve the full content of a specific EFC documentation section.',
    {
      section: z
        .enum(['overview', 'routing', 'middleware', 'ignite', 'auth', 'tasks', 'cli', 'clustering', 'errors', 'env', 'roadmap'])
        .describe('The section name to retrieve.'),
    },
    async ({ section }) => {
      const entry = sectionByName(section);
      if (!entry) {
        return { content: [{ type: 'text', text: `Section "${section}" not found. Available: ${sectionNames().join(', ')}` }] };
      }
      return { content: [{ type: 'text', text: entry.content }] };
    },
  );

  // ─── 3. Resolve file path → URL pattern ──────────────────────────────────
  server.tool(
    'resolve-route',
    'Convert an EFC file path (relative to src/api/) to its HTTP URL pattern.',
    {
      filePath: z.string().describe('File path relative to src/api/, e.g. users/[id].ts or posts/[slug]/comments.ts'),
    },
    async ({ filePath }) => {
      // Strip leading slashes and .ts/.js extension
      let p = filePath.replace(/^\//, '').replace(/\.(ts|js)$/, '');

      // index → empty segment
      p = p.replace(/\/index$/, '');

      // [param] → :param
      p = p.replace(/\[([^\]]+)\]/g, ':$1');

      // Ensure leading slash
      const url = '/' + p.replace(/^\//, '');
      const clean = url === '/' ? '/' : url.replace(/\/$/, '');

      return {
        content: [
          {
            type: 'text',
            text: `File: src/api/${filePath}\nURL Pattern: ${clean}\n\nExport GET, POST, PUT, PATCH, DELETE, HEAD, or OPTIONS from this file to handle those methods. Any unexported method returns 405 Method Not Allowed automatically.`,
          },
        ],
      };
    },
  );

  // ─── 4. Scaffold a route file ─────────────────────────────────────────────
  server.tool(
    'scaffold-route',
    'Generate the TypeScript source code for an EFC route handler file.',
    {
      filePath: z.string().describe('File path relative to src/api/, e.g. users/[id].ts'),
      methods: z
        .array(z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']))
        .min(1)
        .describe('HTTP methods to include.'),
      withAuth: z.boolean().default(false).describe('Add requireAuth route-level middleware.'),
      withValidation: z.boolean().default(false).describe('Add compose() + validateBody() example.'),
    },
    async ({ filePath, methods, withAuth, withValidation }) => {
      const imports = [`import type { Request, Response } from 'express';`];
      const exports: string[] = [];
      const topLevelExports: string[] = [];

      if (withAuth) {
        imports.push(`import { requireAuth } from 'express-file-cluster/auth';`);
        topLevelExports.push(`export const middlewares = [requireAuth];`);
      }

      if (withValidation && methods.includes('POST')) {
        imports.push(`import { compose } from 'express-file-cluster';`);
      }

      for (const method of methods) {
        if (withValidation && method === 'POST') {
          exports.push(
            `export const ${method} = compose(\n  /* validateBody(YourSchema), */\n  async (req: Request, res: Response) => {\n    // TODO: implement ${method} handler\n    res.status(201).json({ ok: true });\n  },\n);`,
          );
        } else {
          const status = method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200;
          const body = method === 'DELETE' ? `res.status(${status}).send();` : `res.status(${status}).json({ ok: true });`;
          exports.push(`export const ${method} = async (req: Request, res: Response) => {\n  // TODO: implement ${method} handler\n  ${body}\n};`);
        }
      }

      const code = [
        ...imports,
        '',
        ...topLevelExports,
        topLevelExports.length ? '' : null,
        ...exports.join('\n\n').split('\n'),
      ]
        .filter((l) => l !== null)
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `// src/api/${filePath}\n${code}`,
          },
        ],
      };
    },
  );

  // ─── 5. Scaffold a background task ────────────────────────────────────────
  server.tool(
    'scaffold-task',
    'Generate the TypeScript source code for an EFC background task.',
    {
      name: z.string().describe('Task class name, e.g. SendEmail or ResizeImage'),
      payloadFields: z
        .array(z.object({ field: z.string(), type: z.string() }))
        .default([])
        .describe('Payload fields, e.g. [{ field: "to", type: "string" }]'),
      thread: z.boolean().default(false).describe('Set to true for CPU-bound tasks that should run in worker_threads.'),
      schedule: z.string().optional().describe('Cron expression for recurring tasks, e.g. "0 9 * * 1"'),
    },
    async ({ name, payloadFields, thread, schedule }) => {
      const iface =
        payloadFields.length > 0
          ? `interface Payload {\n${payloadFields.map((f) => `  ${f.field}: ${f.type};`).join('\n')}\n}`
          : `type Payload = void;`;

      const options: string[] = [];
      if (thread) options.push('thread: true');
      if (schedule) options.push(`schedule: '${schedule}'`);

      const optStr = options.length > 0 ? `{ ${options.join(', ')} }, ` : '';

      const code = `// src/tasks/${name}.ts
import { defineTask } from 'express-file-cluster/tasks';

${iface}

export default defineTask<Payload>(
  ${optStr}async (payload) => {
    // TODO: implement ${name} task
    console.log('[${name}]', payload);
  },
);`;

      return { content: [{ type: 'text', text: code }] };
    },
  );

  // ─── 6. Look up an ignite() option ───────────────────────────────────────
  server.tool(
    'ignite-option',
    'Look up details about a specific ignite() configuration option.',
    {
      option: z.string().describe('Option name, e.g. "cluster", "authStrategy", "tasks"'),
    },
    async ({ option }) => {
      const optionMap: Record<string, string> = {
        port: 'Type: number | Default: 3000\nHTTP listen port for the Express server.',
        apiDir: 'Type: string | Required\nAbsolute path to the directory containing route modules (src/api/).',
        tasksDir: 'Type: string | Required if using tasks\nAbsolute path to the task modules directory (src/tasks/).',
        database: "Type: 'mongodb' | 'postgresql' | Optional\nDatabase engine to connect.",
        databaseUrl: 'Type: string | Default: DATABASE_URL env\nDatabase connection string.',
        authStrategy: "Type: 'http-only' | 'localStorage' | Optional\nToken delivery method.\n- http-only: HttpOnly cookie (recommended for SSR)\n- localStorage: Returns token in response body (SPA-friendly)",
        jwtSecret: 'Type: string | Default: JWT_SECRET env\nJWT signing secret.',
        cluster: 'Type: boolean | Default: true\nEnable multi-core clustering. Auto-disabled in dev mode.',
        workers: 'Type: number | Default: os.cpus().length\nNumber of worker processes to fork.',
        tasks: 'Type: TaskConfig | false | Default: false\nBackground task runtime.\nTaskConfig: { backend: "bullmq", redisUrl: string, concurrency: number }',
        cors: "Type: boolean | CorsConfig | Default: true\nCORS support. Origins driven by CORS_ORIGINS env var (comma-separated).",
        globalMiddlewares: 'Type: RequestHandler[] | Default: []\nExpress middleware applied to every route.',
        onWorkerReady: 'Type: (id: number) => void\nCallback invoked when a worker process boots successfully.',
        onWorkerCrash: 'Type: (id: number, code: number) => void\nCallback invoked before a crashed worker is respawned.',
        onError: 'Type: ErrorRequestHandler\nOverride the built-in global error handler. Receives (err, req, res, next).',
      };

      const info = optionMap[option];
      if (!info) {
        return {
          content: [
            {
              type: 'text',
              text: `Option "${option}" not found.\n\nAvailable options: ${Object.keys(optionMap).join(', ')}`,
            },
          ],
        };
      }

      return {
        content: [{ type: 'text', text: `ignite() option: ${option}\n\n${info}` }],
      };
    },
  );

  // ─── 7. Search across all docs ────────────────────────────────────────────
  server.tool(
    'search-docs',
    'Full-text search across all EFC documentation sections.',
    {
      query: z.string().describe('Search term or phrase.'),
    },
    async ({ query }) => {
      const lower = query.toLowerCase();
      const results: string[] = [];

      for (const [, { name, content }] of Object.entries(docs)) {
        const lines = content.split('\n');
        const matches: string[] = [];

        for (let i = 0; i < lines.length; i++) {
          if (lines[i]!.toLowerCase().includes(lower)) {
            const start = Math.max(0, i - 1);
            const end = Math.min(lines.length - 1, i + 2);
            matches.push(`  Line ${i + 1}: ${lines.slice(start, end + 1).join('\n           ')}`);
          }
        }

        if (matches.length > 0) {
          results.push(`### Section: ${name}\n${matches.slice(0, 5).join('\n')}`);
        }
      }

      if (results.length === 0) {
        return {
          content: [{ type: 'text', text: `No results found for "${query}" in EFC documentation.` }],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Search results for "${query}" in EFC docs:\n\n${results.join('\n\n')}`,
          },
        ],
      };
    },
  );

  // ─── 8. Generate ignite() config snippet ─────────────────────────────────
  server.tool(
    'generate-ignite-config',
    'Generate a ready-to-use ignite() configuration snippet based on your requirements.',
    {
      database: z.enum(['mongodb', 'postgresql', 'none']).describe('Database engine.'),
      auth: z.enum(['http-only', 'localStorage', 'none']).describe('Auth strategy.'),
      cluster: z.boolean().default(true).describe('Enable multi-core clustering.'),
      tasks: z.boolean().default(false).describe('Enable background task queue.'),
      port: z.number().default(3000).describe('HTTP listen port.'),
    },
    async ({ database, auth, cluster, tasks, port }) => {
      const lines: string[] = [
        `import { ignite } from 'express-file-cluster';`,
        `import path from 'path';`,
        `import { fileURLToPath } from 'url';`,
        ``,
        `const __dirname = path.dirname(fileURLToPath(import.meta.url));`,
        ``,
        `ignite({`,
        `  port: ${port},`,
        `  apiDir: path.join(__dirname, 'api'),`,
      ];

      if (tasks) lines.push(`  tasksDir: path.join(__dirname, 'tasks'),`);

      if (database !== 'none') {
        lines.push(`  database: '${database}',`);
        lines.push(`  databaseUrl: process.env.DATABASE_URL,`);
      }

      if (auth !== 'none') {
        lines.push(`  authStrategy: '${auth}',`);
        lines.push(`  jwtSecret: process.env.JWT_SECRET,`);
      }

      lines.push(`  cluster: ${cluster},`);

      if (tasks) {
        lines.push(`  tasks: {`);
        lines.push(`    backend: 'bullmq',`);
        lines.push(`    redisUrl: process.env.REDIS_URL,`);
        lines.push(`    concurrency: 5,`);
        lines.push(`  },`);
      }

      lines.push(`});`);

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
}
