import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, resolveRoute } from '../server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

// Talks to the server through a real MCP client, against docs bundled the way the
// package build does it.
describe('express-file-cluster-mcp', () => {
  let tmp: string;
  let client: Client;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-mcp-'));
    execFileSync('node', [path.join(ROOT, 'scripts/bundle-docs.mjs'), tmp]);
    const server = createServer({ docsDir: path.join(tmp, 'docs') });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test', version: '1.0.0' });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  });

  afterAll(async () => {
    await client.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    return { text: r.content.map((c) => c.text).join('\n'), isError: Boolean(r.isError) };
  };

  it('serves every docs page and skill card as a resource', async () => {
    const { resources } = await client.listResources();
    const docCount = execFileSync('find', [path.join(ROOT, 'docs'), '-name', '*.md'])
      .toString()
      .trim()
      .split('\n').length;
    const skillCount = fs
      .readdirSync(path.join(ROOT, 'Skills/efc'))
      .filter((f) => f.endsWith('.md')).length;
    expect(resources).toHaveLength(docCount + skillCount);
    const db = resources.find((r) => r.uri === 'efc://docs/guides/database');
    expect(db?.title).toBe('Database Guide');
    const read = await client.readResource({ uri: 'efc://docs/guides/database' });
    expect((read.contents[0] as { text: string }).text).toContain('defineModel');
  });

  it('get-rules returns the API surface and the do-not-invent list', async () => {
    const { text } = await call('get-rules');
    expect(text).toContain('express-file-cluster/auth');
    expect(text).toContain('do NOT exist');
  });

  it('lists, reads and searches docs', async () => {
    expect((await call('list-docs')).text).toContain('guides/database');
    expect((await call('get-doc', { id: 'api-reference/ignite' })).text).toContain('basePath');
    expect((await call('get-doc', { id: 'efc://docs/guides/validation.md' })).text).toContain(
      'Standard Schema',
    );
    const missing = await call('get-doc', { id: 'nope/nothing' });
    expect(missing.isError).toBe(true);
    const search = await call('search-docs', { query: 'transaction', limit: 3 });
    expect(search.text).toMatch(/### (guides\/database|api-reference\/db)/);
  });

  it('resolves routes by the routing rules', async () => {
    expect(resolveRoute('users/index.ts').pattern).toBe('/users');
    expect(resolveRoute('index.ts').pattern).toBe('/');
    expect(resolveRoute('users/[id].ts')).toEqual({ pattern: '/users/:id', params: ['id'] });
    expect(resolveRoute('users/[[id]].ts').pattern).toBe('/users/:id?');
    expect(resolveRoute('src/api/docs/[...slug].ts').pattern).toBe('/docs/:slug*');
    expect(resolveRoute('docs/[[...slug]].ts').pattern).toBe('/docs/:slug*?');
    expect(() => resolveRoute('[...a]/b.ts')).toThrow(/last segment/);
    const r = await call('resolve-route', { filePath: 'posts/[slug]/comments.ts' });
    expect(r.text).toContain('Mounted:  /v1/api/posts/:slug/comments');
  });

  it('scaffolds routes and tasks that follow the conventions', async () => {
    const route = (
      await call('scaffold-route', {
        filePath: 'products/[id].ts',
        methods: ['GET', 'PATCH'],
        auth: ['admin'],
        validation: true,
      })
    ).text;
    expect(route).toContain(`export const middlewares = [requireAuth('admin')];`);
    expect(route).toContain(`PATCH: { params: z.object({ id: z.string() }), body:`);
    expect(route).toContain('export const GET = async');
    const task = (
      await call('scaffold-task', { name: 'Digest', schedule: '0 9 * * 1', timezone: 'UTC' })
    ).text;
    expect(task).toContain(`defineTask<Payload>({ schedule: '0 9 * * 1', timezone: 'UTC' }, async`);
  });

  it('offers prompts that point at the docs', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain('efc-model');
    const p = await client.getPrompt({ name: 'efc-model', arguments: { entity: 'orders' } });
    expect((p.messages[0]!.content as { text: string }).text).toContain('guides/database');
  });
});
