/**
 * Tools an agent calls to read the EFC docs and to generate files that follow the
 * framework's conventions. Everything factual comes from the bundled docs, so the
 * server can't drift from the version it ships with.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { searchDocs, type DocPage } from './docs.js';

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const error = (t: string) => ({ ...text(t), isError: true });

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

/** The pages to read before writing any EFC code. */
export const RULE_PAGES = ['skills/SKILL', 'skills/api-surface', 'skills/what-not-to-invent'];

/** File path (relative to src/api) → route pattern, by the routing rules. */
export function resolveRoute(filePath: string): { pattern: string; params: string[] } {
  let p = filePath
    .replace(/\\/g, '/')
    .replace(/^\.?\/?(src\/)?(api\/)?/, '')
    .replace(/\.(ts|js|mts|mjs|cts|cjs)$/, '')
    .replace(/(^|\/)index$/, '');
  const segments = p ? p.split('/') : [];
  const params: string[] = [];
  const out = segments.map((seg, i) => {
    const m =
      /^\[\[\.\.\.(\w+)\]\]$/.exec(seg) ??
      /^\[\.\.\.(\w+)\]$/.exec(seg) ??
      /^\[\[(\w+)\]\]$/.exec(seg) ??
      /^\[(\w+)\]$/.exec(seg);
    if (!m) return seg;
    const name = m[1]!;
    params.push(name);
    const catchAll = seg.includes('...');
    if (catchAll && i !== segments.length - 1) {
      throw new Error(`catch-all segment "${seg}" must be the last segment (startup error)`);
    }
    const optional = seg.startsWith('[[');
    return `:${name}${catchAll ? '*' : ''}${optional ? '?' : ''}`;
  });
  p = out.join('/');
  return { pattern: `/${p}`, params };
}

export function registerTools(server: McpServer, pages: DocPage[]): void {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const find = (id: string) => {
    const key = id
      .trim()
      .replace(/^efc:\/\/docs\//, '')
      .replace(/^\/+|\.md$/g, '');
    return (
      byId.get(key) ??
      byId.get(`${key}/index`) ??
      pages.find((p) => p.title.toLowerCase() === key.toLowerCase()) ??
      pages.filter((p) => p.id.endsWith(`/${key}`)).at(0)
    );
  };

  server.registerTool(
    'get-rules',
    {
      title: 'EFC ground rules',
      description:
        'Call this FIRST before writing or reviewing EFC (express-file-cluster) code: the exact public API, the only valid import paths, and the list of things that do not exist. Prevents invented APIs.',
    },
    async () =>
      text(
        RULE_PAGES.map((id) => byId.get(id)?.content)
          .filter(Boolean)
          .join('\n\n---\n\n'),
      ),
  );

  server.registerTool(
    'list-docs',
    {
      title: 'List EFC docs',
      description: 'List every EFC documentation page (id, title, one-line summary).',
    },
    async () => {
      const groups = new Map<string, DocPage[]>();
      for (const p of pages) {
        const group = p.id.includes('/') ? p.id.split('/')[0]! : '(root)';
        groups.set(group, [...(groups.get(group) ?? []), p]);
      }
      const out = [...groups]
        .map(
          ([group, list]) =>
            `## ${group}\n${list.map((p) => `- ${p.id} — ${p.title}${p.summary ? `: ${p.summary}` : ''}`).join('\n')}`,
        )
        .join('\n\n');
      return text(`EFC documentation — read a page with get-doc { id }.\n\n${out}`);
    },
  );

  server.registerTool(
    'get-doc',
    {
      title: 'Read an EFC doc page',
      description:
        'Return the full markdown of one EFC documentation page, by id from list-docs (e.g. "guides/database", "api-reference/ignite", "skills/routing-rules").',
      inputSchema: { id: z.string().describe('Page id, e.g. "guides/database"') },
    },
    async ({ id }) => {
      const page = find(id);
      if (!page) return error(`No doc "${id}". Ids: ${pages.map((p) => p.id).join(', ')}`);
      return text(page.content);
    },
  );

  server.registerTool(
    'search-docs',
    {
      title: 'Search the EFC docs',
      description:
        'Full-text search across all EFC docs and reference cards. All words must match; results are ranked, with snippets. Follow up with get-doc.',
      inputSchema: {
        query: z.string().min(1).describe('Words to search for, e.g. "transaction postgres"'),
        limit: z.number().int().min(1).max(20).default(6).describe('Pages to return'),
      },
    },
    async ({ query, limit }) => {
      const hits = searchDocs(pages, query).slice(0, limit);
      if (hits.length === 0) return text(`No EFC docs match "${query}".`);
      return text(
        hits
          .map(
            (h) =>
              `### ${h.page.id} — ${h.page.title}\n${h.snippets.map((s) => '```\n' + s + '\n```').join('\n')}`,
          )
          .join('\n\n'),
      );
    },
  );

  server.registerTool(
    'resolve-route',
    {
      title: 'File path → route',
      description:
        'Turn a route file path (relative to src/api) into the URL pattern EFC mounts, following the routing rules ([id], [[id]], [...slug], [[...slug]], index files).',
      inputSchema: {
        filePath: z.string().describe('e.g. "users/[id].ts" or "docs/[[...slug]].ts"'),
        basePath: z.string().default('/v1/api').describe("ignite()'s basePath (default '/v1/api')"),
      },
    },
    async ({ filePath, basePath }) => {
      try {
        const { pattern, params } = resolveRoute(filePath);
        const base = basePath === '/' ? '' : basePath.replace(/\/$/, '');
        return text(
          [
            `File:     src/api/${filePath.replace(/^\.?\/?(src\/)?(api\/)?/, '')}`,
            `Pattern:  ${pattern}`,
            `Mounted:  ${base}${pattern === '/' && base ? '' : pattern}`,
            params.length ? `Params:   ${params.join(', ')}` : 'Params:   (none)',
            '',
            'Export uppercase GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS handlers; other methods answer 405.',
            '[...x] params arrive as string[] (≥1 segment); [[...x]] also matches zero segments.',
          ].join('\n'),
        );
      } catch (err) {
        return error((err as Error).message);
      }
    },
  );

  server.registerTool(
    'scaffold-route',
    {
      title: 'Generate a route file',
      description:
        'Generate an EFC route file: method handlers, optional requireAuth (with roles), optional request-validation schema.',
      inputSchema: {
        filePath: z.string().describe('Relative to src/api, e.g. "products/[id].ts"'),
        methods: z.array(z.enum(METHODS)).min(1),
        auth: z
          .union([z.boolean(), z.array(z.string()).min(1)])
          .default(false)
          .describe('true = requireAuth; ["admin"] = requireAuth("admin") role check'),
        validation: z
          .boolean()
          .default(false)
          .describe('Add an `export const schema` (zod) for params/body'),
      },
    },
    async ({ filePath, methods, auth, validation }) => {
      let params: string[];
      try {
        params = resolveRoute(filePath).params;
      } catch (err) {
        return error((err as Error).message);
      }
      const lines: string[] = [`import type { Request, Response } from 'express';`];
      if (methods.some((m) => m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS')) {
        lines.push(`import { HttpError } from 'express-file-cluster';`);
      }
      if (auth) lines.push(`import { requireAuth } from 'express-file-cluster/auth';`);
      if (validation) lines.push(`import { z } from 'zod';`);
      lines.push('');
      if (auth) {
        lines.push(
          Array.isArray(auth)
            ? `export const middlewares = [requireAuth(${auth.map((r) => `'${r}'`).join(', ')})];`
            : `export const middlewares = [requireAuth];`,
          '',
        );
      }
      if (validation) {
        const paramShape = params.map((p) => `${p}: z.string()`).join(', ');
        const entries = methods
          .map((m) => {
            const parts: string[] = [];
            if (params.length) parts.push(`params: z.object({ ${paramShape} })`);
            if (m === 'POST' || m === 'PUT' || m === 'PATCH') {
              parts.push(`body: z.object({ /* fields */ })${m === 'PATCH' ? '.partial()' : ''}`);
            }
            return parts.length ? `  ${m}: { ${parts.join(', ')} },` : '';
          })
          .filter(Boolean);
        if (entries.length) lines.push('export const schema = {', ...entries, '};', '');
      }
      for (const m of methods) {
        const status = m === 'POST' ? 201 : m === 'DELETE' ? 204 : 200;
        const body =
          m === 'DELETE' || m === 'HEAD' || m === 'OPTIONS'
            ? `res.status(${status}).end();`
            : `res.status(${status}).json({ ok: true });`;
        lines.push(
          `export const ${m} = async (req: Request, res: Response) => {`,
          `  // TODO: implement — throw new HttpError(404, '...') for errors`,
          `  ${body}`,
          `};`,
          '',
        );
      }
      const clean = filePath.replace(/^\.?\/?(src\/)?(api\/)?/, '');
      return text(`// src/api/${clean}\n${lines.join('\n').trimEnd()}\n`);
    },
  );

  server.registerTool(
    'scaffold-task',
    {
      title: 'Generate a background task',
      description:
        'Generate an EFC task file for src/tasks (task name = file name; the folder is not scanned recursively).',
      inputSchema: {
        name: z
          .string()
          .regex(/^[A-Za-z][\w-]*$/)
          .describe('Task name = file basename, e.g. "SendEmail"'),
        payload: z
          .array(z.object({ field: z.string(), type: z.string() }))
          .default([])
          .describe('Payload fields, e.g. [{ field: "to", type: "string" }]'),
        thread: z.boolean().default(false).describe('Run in worker_threads (CPU-bound work)'),
        retries: z.number().int().min(0).optional().describe('Re-runs after a failure (default 3)'),
        schedule: z.string().optional().describe('Cron expression; scheduled runs get payload {}'),
        timezone: z.string().optional().describe('IANA timezone for schedule'),
      },
    },
    async ({ name, payload, thread, retries, schedule, timezone }) => {
      const type = payload.length
        ? `interface Payload {\n${payload.map((f) => `  ${f.field}: ${f.type};`).join('\n')}\n}`
        : `type Payload = Record<string, never>;`;
      const opts: string[] = [];
      if (thread) opts.push('thread: true');
      if (retries !== undefined) opts.push(`retries: ${retries}`);
      if (schedule) opts.push(`schedule: '${schedule}'`);
      if (timezone) opts.push(`timezone: '${timezone}'`);
      const optArg = opts.length ? `{ ${opts.join(', ')} }, ` : '';
      return text(
        [
          `// src/tasks/${name}.ts — enqueue with: await enqueue('${name}', payload)`,
          `import { defineTask } from 'express-file-cluster/tasks';`,
          '',
          type,
          '',
          `export default defineTask<Payload>(${optArg}async (payload) => {`,
          `  // TODO: implement ${name}`,
          `});`,
          '',
        ].join('\n'),
      );
    },
  );
}
