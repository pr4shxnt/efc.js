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

function docSectionEnum() {
  const names = sectionNames() as [string, ...string[]];
  return z.enum(names);
}

// ── Shared ignite() option map ────────────────────────────────────────────────

const IGNITE_OPTIONS: Record<string, { type: string; default: string; description: string }> = {
  port:              { type: 'number',                          default: '3000',             description: 'HTTP listen port for the Express server.' },
  apiDir:            { type: 'string',                          default: '(required)',        description: 'Absolute path to the directory containing route modules (src/api/).' },
  tasksDir:          { type: 'string',                          default: '(required for tasks)', description: 'Absolute path to the task modules directory (src/tasks/).' },
  database:          { type: "'mongodb' | 'postgresql'",        default: '—',                description: 'Database engine. Note: postgresql is Phase 2 (not yet implemented).' },
  databaseUrl:       { type: 'string',                          default: 'DATABASE_URL env', description: 'Database connection string.' },
  authStrategy:      { type: "'http-only' | 'localStorage'",    default: '—',                description: "Token delivery method.\n  - http-only: HttpOnly cookie (recommended for SSR)\n  - localStorage: Returns token in response body (SPA-friendly)" },
  jwtSecret:         { type: 'string',                          default: 'JWT_SECRET env',   description: 'JWT signing secret.' },
  cluster:           { type: 'boolean',                         default: 'true',             description: 'Enable multi-core clustering. Auto-disabled in dev mode.' },
  workers:           { type: 'number',                          default: 'os.cpus().length', description: 'Number of worker processes to fork.' },
  tasks:             { type: 'TaskConfig | false',              default: 'false',            description: 'Background task runtime.\nTaskConfig: { backend: "bullmq", redisUrl: string, concurrency: number }' },
  cors:              { type: 'boolean | CorsConfig',            default: 'true',             description: 'CORS support. Origins driven by CORS_ORIGINS env var (comma-separated).' },
  globalMiddlewares: { type: 'RequestHandler[]',                default: '[]',               description: 'Express middleware applied to every route.' },
  onWorkerReady:     { type: '(id: number) => void',            default: '—',                description: 'Callback invoked when a worker process boots successfully.' },
  onWorkerCrash:     { type: '(id: number, code: number) => void', default: '—',            description: 'Callback invoked before a crashed worker is respawned.' },
  onError:           { type: 'ErrorRequestHandler',             default: 'built-in',         description: 'Override the built-in global error handler. Receives (err, req, res, next).' },
};

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
      section: docSectionEnum().describe('The section name to retrieve.'),
    },
    async ({ section }) => {
      const entry = sectionByName(section);
      if (!entry) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Section "${section}" not found. Available: ${sectionNames().join(', ')}` }],
        };
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
      let p = filePath.replace(/^\//, '').replace(/\.(ts|js)$/, '');

      // Strip trailing /index (and handle bare "index" at the root)
      p = p.replace(/(\/index|^index)$/, '');

      // [param] → :param
      p = p.replace(/\[([^\]]+)\]/g, ':$1');

      const url = p === '' ? '/' : '/' + p.replace(/^\//, '');

      return {
        content: [
          {
            type: 'text',
            text: `File: src/api/${filePath}\nURL Pattern: ${url}\n\nExport GET, POST, PUT, PATCH, DELETE, HEAD, or OPTIONS from this file to handle those methods. Any unexported method returns 405 Method Not Allowed automatically.`,
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

      const parts: string[] = [...imports, ''];
      if (topLevelExports.length > 0) parts.push(...topLevelExports, '');
      parts.push(...exports.join('\n\n').split('\n'));
      const code = parts.join('\n');

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
      schedule: z.string().optional().describe('Cron expression for recurring tasks, e.g. "0 9 * * 1". NOTE: cron scheduling is a Phase 2 feature — the option is accepted but not yet executed at runtime.'),
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

      const scheduleNote = schedule
        ? `\n// NOTE: 'schedule' is a Phase 2 feature. The option is parsed but cron execution is not yet implemented.`
        : '';

      const code = `// src/tasks/${name}.ts${scheduleNote}
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
      const info = IGNITE_OPTIONS[option];
      if (!info) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Option "${option}" not found.\n\nAvailable options: ${Object.keys(IGNITE_OPTIONS).join(', ')}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `ignite() option: ${option}\n\nType: ${info.type}\nDefault: ${info.default}\n\n${info.description}`,
          },
        ],
      };
    },
  );

  // ─── 7. List all ignite() options ────────────────────────────────────────
  server.tool(
    'list-ignite-options',
    'List all available ignite() configuration options with their types and defaults.',
    {},
    async () => {
      const rows = Object.entries(IGNITE_OPTIONS)
        .map(([key, { type, default: def, description }]) => {
          const firstLine = description.split('\n')[0]!;
          return `• ${key}\n  Type: ${type}\n  Default: ${def}\n  ${firstLine}`;
        })
        .join('\n\n');
      return { content: [{ type: 'text', text: `ignite() configuration options:\n\n${rows}` }] };
    },
  );

  // ─── 8. Search across all docs ────────────────────────────────────────────
  server.tool(
    'search-docs',
    'Full-text search across all EFC documentation sections.',
    {
      query: z.string().describe('Search term or phrase.'),
      maxPerSection: z.number().int().min(1).max(20).default(5).describe('Max context snippets to return per section (default 5).'),
    },
    async ({ query, maxPerSection }) => {
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
          const truncated = matches.length > maxPerSection;
          const shown = matches.slice(0, maxPerSection);
          const suffix = truncated ? `\n  … ${matches.length - maxPerSection} more match(es) not shown` : '';
          results.push(`### Section: ${name}\n${shown.join('\n')}${suffix}`);
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

  // ─── 9. Generate ignite() config snippet ─────────────────────────────────
  server.tool(
    'generate-ignite-config',
    'Generate a ready-to-use ignite() configuration snippet based on your requirements.',
    {
      database: z.enum(['mongodb', 'postgresql', 'none']).describe('Database engine. Note: postgresql is a Phase 2 feature and not yet implemented.'),
      auth: z.enum(['http-only', 'localStorage', 'none']).describe('Auth strategy.'),
      cluster: z.boolean().default(true).describe('Enable multi-core clustering.'),
      tasks: z.boolean().default(false).describe('Enable background task queue.'),
      port: z.number().default(3000).describe('HTTP listen port.'),
    },
    async ({ database, auth, cluster, tasks, port }) => {
      const warnings: string[] = [];

      if (database === 'postgresql') {
        warnings.push('// WARNING: PostgreSQL adapter is a Phase 2 feature and is not yet implemented. Only MongoDB is available in the current release.');
      }

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

      const output = warnings.length > 0
        ? `${warnings.join('\n')}\n\n${lines.join('\n')}`
        : lines.join('\n');

      return { content: [{ type: 'text', text: output }] };
    },
  );

  // ─── 10. Scaffold a middleware file ───────────────────────────────────────
  server.tool(
    'scaffold-middleware',
    'Generate the TypeScript source code for a standalone EFC middleware function.',
    {
      name: z.string().describe('Middleware function name in camelCase, e.g. requireAdmin or rateLimiter'),
      description: z.string().optional().describe('Short description of what this middleware does, used in the file comment.'),
      readsToken: z.boolean().default(false).describe('Import and use the JWT token from the request (e.g. for role-based checks after requireAuth).'),
    },
    async ({ name, description, readsToken }) => {
      const imports = [`import type { Request, Response, NextFunction } from 'express';`];

      if (readsToken) {
        imports.push(`// Access req.user populated by requireAuth`);
      }

      const commentLine = description ? `// ${description}` : `// ${name} middleware`;

      const code = `// src/middlewares/${name}.ts
${commentLine}
${imports.join('\n')}

export function ${name}(req: Request, res: Response, next: NextFunction): void {
  // TODO: implement ${name} logic
  // Call next() to continue, or throw an HttpError to reject the request
  next();
}`;

      return { content: [{ type: 'text', text: code }] };
    },
  );

  // ─── 11. Check common mistakes ────────────────────────────────────────────
  server.tool(
    'check-common-mistakes',
    'Return a list of known EFC gotchas and anti-patterns to avoid when generating code.',
    {},
    async () => {
      const mistakes = [
        {
          title: 'ignite() does not auto-load efc.config.ts',
          fix: 'Import your config file and pass it explicitly: ignite(config)',
        },
        {
          title: 'apiDir must be an absolute path in production',
          fix: "Use path.join(__dirname, 'api') — relative paths fail after bundling.",
        },
        {
          title: 'db throws if accessed before Pre-Flight completes',
          fix: 'Never call db at module load time. Only access inside route handlers or after ignite() resolves.',
        },
        {
          title: 'requireAuth takes no arguments',
          fix: "Use requireAuth as-is. There is no built-in role parameter. For roles, write a separate middleware that reads req.user.",
        },
        {
          title: 'revokeToken only clears the cookie',
          fix: 'The JWT itself stays valid until expiry. If you need immediate invalidation, maintain a server-side deny-list.',
        },
        {
          title: 'HTTP method exports must be uppercase',
          fix: "Export GET, POST, PUT, PATCH, DELETE — not get, post, etc. Lowercase exports are silently ignored.",
        },
        {
          title: 'tasksDir is NOT scanned recursively',
          fix: 'All task files must be at the top level of tasksDir. Subdirectories are not processed.',
        },
        {
          title: 'No wildcard/catch-all routes',
          fix: '[...params] is a Phase 2 feature. Do not generate catch-all routes.',
        },
        {
          title: 'middlewares export must be an array',
          fix: "export const middlewares = [requireAuth]; — not a function call, not a single value.",
        },
        {
          title: "Invalid sub-paths: /db, /router, /errors, /models, /config don't exist",
          fix: 'Only three imports are valid: express-file-cluster, express-file-cluster/auth, express-file-cluster/tasks',
        },
      ];

      const text = mistakes
        .map((m, i) => `${i + 1}. ❌ ${m.title}\n   ✅ ${m.fix}`)
        .join('\n\n');

      return {
        content: [{ type: 'text', text: `EFC Common Mistakes to Avoid:\n\n${text}` }],
      };
    },
  );

  // ─── 12. List not-yet-implemented features ────────────────────────────────
  server.tool(
    'list-not-implemented',
    'List EFC features that are planned but NOT yet implemented (Phase 2+). Do not generate code for these.',
    {},
    async () => {
      const notImplemented = [
        { feature: 'PostgreSQL adapter', phase: 2, note: 'Only MongoDB/mongoose is live.' },
        { feature: 'pg-boss task backend', phase: 2, note: 'Only bullmq is supported.' },
        { feature: 'Wildcard/catch-all routes ([...params])', phase: 2, note: 'Route file name parses but router ignores it.' },
        { feature: 'Cron/scheduled tasks (schedule option)', phase: 2, note: 'The option is accepted but never executed at runtime.' },
        { feature: 'Database migrations, rollback, seed, studio CLI', phase: 2, note: 'CLI commands are stubs.' },
        { feature: 'Plugin system', phase: 3, note: 'No extension API exists yet.' },
        { feature: 'WebSockets', phase: 3, note: 'Not wired into the server.' },
        { feature: 'efc lint, efc deploy, efc --version', phase: 2, note: 'Commands are not implemented.' },
        { feature: 'OpenAPI / schema generation', phase: 3, note: 'No decorator or codegen layer.' },
        { feature: 'Edge / serverless deployment', phase: 4, note: 'Cluster model assumes a long-running process.' },
      ];

      const text = notImplemented
        .map((n) => `• [Phase ${n.phase}] ${n.feature}\n  Note: ${n.note}`)
        .join('\n\n');

      return {
        content: [
          {
            type: 'text',
            text: `EFC Features NOT Yet Implemented (do not generate code for these):\n\n${text}\n\nCurrent version: v0.2.x (Beta). See the roadmap doc for timeline.`,
          },
        ],
      };
    },
  );
}
