import { afterEach, expect, it } from 'vitest';
import { z } from 'zod';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createRequire } from 'node:module';
import { generateOpenAPI } from '../openapi.js';
import { createTestApp } from '../testing.js';
import type { MountedRoute } from '../types.js';
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const route = (urlPath: string, extra: Partial<MountedRoute> = {}): MountedRoute => ({
  urlPath,
  filePath: '/fixture.js',
  params: [],
  methods: ['GET'],
  ...extra,
});
it('generates versioned paths, metadata, examples, JSON-schema parameters and request bodies from Zod', async () => {
  const doc = await generateOpenAPI(
    [
      route('/users/:id', {
        methods: ['POST'],
        schema: {
          POST: {
            params: z.object({ id: z.string().uuid() }),
            query: z.object({ page: z.string().optional() }),
            body: z.object({ name: z.string().min(2) }),
          },
        },
        meta: {
          POST: {
            summary: 'Create',
            tags: ['users'],
            response: { status: 201, body: { ok: true } },
            openapi: { security: [{ bearerAuth: [] }] },
          },
        },
      }),
    ],
    {
      basePath: '/v2',
      info: { title: 'API', version: '2' },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    },
  );
  const op = doc.paths['/v2/users/{id}']!.post as Record<string, unknown>;
  expect(doc.openapi).toBe('3.1.0');
  expect(op).toMatchObject({
    summary: 'Create',
    tags: ['users'],
    security: [{ bearerAuth: [] }],
    responses: { '201': { content: { 'application/json': { example: { ok: true } } } }, '400': {} },
  });
  expect(op.parameters).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
      expect.objectContaining({ name: 'page', in: 'query', required: false }),
    ]),
  );
  expect(op.requestBody).toMatchObject({
    content: {
      'application/json': { schema: { $ref: expect.stringContaining('#/components/schemas/') } },
    },
  });
  expect(Object.values(doc.components.schemas)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ properties: { name: expect.objectContaining({ minLength: 2 }) } }),
    ]),
  );
});
it('expands optional and catch-all paths, excludes WS-only/hidden operations and avoids nonexistent path parameters', async () => {
  const doc = await generateOpenAPI(
    [
      route('/docs/:slug*?', { websocket: true }),
      route('/secret', { meta: { GET: { openapi: { hidden: true } } } }),
      route('/socket', { methods: [], websocket: true }),
    ],
    { basePath: '/' },
  );
  expect(Object.keys(doc.paths).sort()).toEqual(['/docs', '/docs/{slug}']);
  expect(doc.paths['/docs']!.get).not.toHaveProperty('parameters');
  expect(doc.paths['/docs/{slug}']!.get).toMatchObject({
    parameters: [{ name: 'slug', in: 'path', required: true }],
    'x-efc-catch-all': true,
  });
});
it('rebases recursive refs into components and provides an explicit adapter for older validators', async () => {
  const validator = { safeParse: () => ({ success: true }) };
  await expect(generateOpenAPI([route('/x', { schema: { body: validator } })])).rejects.toThrow(
    'schemaToJSONSchema',
  );
  const doc = await generateOpenAPI([route('/x', { schema: { body: validator } })], {
    schemaToJSONSchema: () => ({
      type: 'object',
      properties: { child: { $ref: '#' } },
      $defs: { nested: { $ref: '#/properties/child' } },
    }),
  });
  expect(doc.components.schemas.EfcRequest1).toMatchObject({
    properties: { child: { $ref: '#/components/schemas/EfcRequest1' } },
    $defs: { nested: { $ref: '#/components/schemas/EfcRequest1/properties/child' } },
  });
});
it('serves opt-in JSON through global middleware, protects routes from URL collisions and leaves it off by default', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-openapi-'));
  dirs.push(dir);
  fs.writeFileSync(
    path.join(dir, 'health.js'),
    'export const GET=(_req,res)=>res.json({ok:true});',
  );
  const disabled = await createTestApp({ apiDir: dir });
  expect((await request(disabled).get('/openapi.json')).status).toBe(404);
  const app = await createTestApp({
    apiDir: dir,
    openapi: { path: '/schema.json' },
    globalMiddlewares: [
      (_req, res, next) => {
        res.set('X-Global', 'yes');
        next();
      },
    ],
  });
  const response = await request(app).get('/schema.json');
  expect(response.status).toBe(200);
  expect(response.headers['x-global']).toBe('yes');
  expect(response.body.paths['/v1/api/health']).toHaveProperty('get');
  await expect(createTestApp({ apiDir: dir, openapi: { path: '/v1/api/health' } })).rejects.toThrow(
    'conflicts',
  );
});

it('supports offline directory generation and keeps literal refs in example data intact', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-openapi-offline-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'health.js'), 'export const GET=()=>{};');
  expect((await generateOpenAPI(dir)).paths['/v1/api/health']).toHaveProperty('get');
  const validator = { safeParse: () => ({ success: true }) };
  const doc = await generateOpenAPI(
    [route('/a-b', { schema: { body: validator } }), route('/a_b')],
    {
      schemaToJSONSchema: () => ({
        type: 'object',
        properties: { examples: { $ref: '#' } },
        examples: [{ $ref: '#' }],
      }),
    },
  );
  expect(doc.components.schemas.EfcRequest1).toMatchObject({
    properties: { examples: { $ref: '#/components/schemas/EfcRequest1' } },
    examples: [{ $ref: '#' }],
  });
  expect((doc.paths['/v1/api/a-b']!.get as { operationId: string }).operationId).not.toBe(
    (doc.paths['/v1/api/a_b']!.get as { operationId: string }).operationId,
  );
});

it('packaged CommonJS generation imports ESM routes with top-level await', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-openapi-cjs-'));
  dirs.push(dir);
  fs.writeFileSync(
    path.join(dir, 'async.mjs'),
    'await Promise.resolve(); export const GET=()=>{};',
  );
  const api = createRequire(import.meta.url)('express-file-cluster') as {
    generateOpenAPI: typeof generateOpenAPI;
  };
  expect((await api.generateOpenAPI(dir)).paths['/v1/api/async']).toHaveProperty('get');
});

it('preserves named Zod parameter shapes and explicit JSON Schema resource IDs', async () => {
  const doc = await generateOpenAPI([
    route('/named/:id', {
      schema: {
        params: z.object({ id: z.string().uuid() }).meta({ id: 'NamedParams' }),
        query: z.object({ page: z.string().optional() }).meta({ id: 'NamedQuery' }),
      },
    }),
  ]);
  const parameters = (
    doc.paths['/v1/api/named/{id}']!.get as {
      parameters: Array<{ name: string; schema: { $ref: string } }>;
    }
  ).parameters;
  expect(parameters.find((p) => p.name === 'id')!.schema.$ref).toContain(
    '/$defs/NamedParams/properties/id',
  );
  expect(parameters.find((p) => p.name === 'page')!.schema.$ref).toContain(
    '/$defs/NamedQuery/properties/page',
  );
  const validator = { safeParse: () => ({ success: true }) };
  const scoped = await generateOpenAPI([route('/resource', { schema: { body: validator } })], {
    schemaToJSONSchema: () => ({
      $id: 'https://schemas.example.com/Resource',
      type: 'object',
      properties: { child: { $ref: '#' } },
    }),
  });
  expect(scoped.components.schemas.EfcRequest1).toMatchObject({
    properties: { child: { $ref: '#' } },
  });
});

it('rejects document URLs that shadow hidden, dynamic or HEAD routes using Express matching rules', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-openapi-conflicts-'));
  dirs.push(dir);
  const auth = JSON.stringify(path.resolve(import.meta.dirname, '../auth/index.ts'));
  fs.writeFileSync(
    path.join(dir, 'private.mjs'),
    `import {requireAuth} from ${auth}; export const middlewares=[requireAuth]; export const meta={GET:{openapi:{hidden:true}}}; export const GET=(_req,res)=>res.json({private:true});`,
  );
  fs.writeFileSync(path.join(dir, 'head.mjs'), 'export const HEAD=(_req,res)=>res.end();');
  fs.mkdirSync(path.join(dir, 'users'));
  fs.writeFileSync(
    path.join(dir, 'users', '[id].mjs'),
    'export const GET=(_req,res)=>res.json({ok:true});',
  );
  const options = { apiDir: dir, auth: { secret: 'collision-test', strategy: 'bearer' as const } };
  expect((await request(await createTestApp(options)).get('/v1/api/private')).status).toBe(401);
  for (const url of ['/v1/api/private', '/V1/API/PRIVATE/', '/v1/api/users/me', '/v1/api/head']) {
    await expect(createTestApp({ ...options, openapi: { path: url } })).rejects.toThrow(
      'conflicts',
    );
  }
});

it('documents every union query field and preserves branch requirements and the complete query schema', async () => {
  const doc = await generateOpenAPI([
    route('/search', {
      schema: {
        query: z.union([
          z.object({ mode: z.literal('byId'), id: z.string() }),
          z.object({ mode: z.literal('all'), page: z.string().optional() }),
        ]),
      },
    }),
  ]);
  const op = doc.paths['/v1/api/search']!.get as {
    parameters: Array<{ name: string; required: boolean; schema: unknown }>;
    'x-efc-query-schema': unknown;
  };
  expect(op.parameters.map((p) => [p.name, p.required])).toEqual([
    ['mode', true],
    ['id', false],
    ['page', false],
  ]);
  expect(op.parameters[0]!.schema).toMatchObject({
    anyOf: [
      { $ref: expect.stringContaining('/anyOf/0/properties/mode') },
      { $ref: expect.stringContaining('/anyOf/1/properties/mode') },
    ],
  });
  expect(op['x-efc-query-schema']).toEqual({ $ref: '#/components/schemas/EfcRequest1' });
  expect(doc.components.schemas.EfcRequest1).toMatchObject({
    anyOf: [{ required: ['mode', 'id'] }, { required: ['mode'] }],
  });
});

it('uses deepObject serialization for object query fields, including named refs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-openapi-query-'));
  dirs.push(dir);
  const zod = JSON.stringify(createRequire(import.meta.url).resolve('zod'));
  fs.writeFileSync(
    path.join(dir, 'search.mjs'),
    `import {z} from ${zod}; const filter=z.object({name:z.string()}).meta({id:'Filter'}); export const schema={GET:{query:z.object({filter})}}; export const GET=(req,res)=>res.json(req.query);`,
  );
  const app = await createTestApp({ apiDir: dir });
  const doc = await generateOpenAPI(dir);
  expect((doc.paths['/v1/api/search']!.get as { parameters: unknown[] }).parameters).toEqual([
    expect.objectContaining({ name: 'filter', in: 'query', style: 'deepObject', explode: true }),
  ]);
  expect((await request(app).get('/v1/api/search?name=Alice')).status).toBe(400);
  const result = await request(app).get('/v1/api/search?filter[name]=Alice');
  expect(result.status).toBe(200);
  expect(result.body).toEqual({ filter: { name: 'Alice' } });
});

it('collapses equivalent optional expansions using the actual first-parameter binding', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-openapi-optional-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, 'optional', '[[first]]'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'optional', '[[first]]', '[[second]].mjs'),
    'export const GET=(req,res)=>res.json(req.params);',
  );
  const doc = await generateOpenAPI(dir);
  expect(Object.keys(doc.paths).sort()).toEqual([
    '/v1/api/optional',
    '/v1/api/optional/{first}',
    '/v1/api/optional/{first}/{second}',
  ]);
  const app = await createTestApp({ apiDir: dir });
  expect((await request(app).get('/v1/api/optional/one')).body).toEqual({ first: 'one' });
  expect((await request(app).get('/v1/api/optional/one/two')).body).toEqual({
    first: 'one',
    second: 'two',
  });
  await expect(generateOpenAPI([route('/users/:id'), route('/users/:name')])).rejects.toThrow(
    'ambiguous paths',
  );
});

it('reports unrepresentable query shapes instead of silently dropping them, with explicit parameter overrides available', async () => {
  const query = z.string();
  await expect(generateOpenAPI([route('/bad', { schema: { query } })])).rejects.toThrow(
    'GET /bad query',
  );
  const parameters = [{ name: 'value', in: 'query', schema: { type: 'string' } }];
  const doc = await generateOpenAPI([
    route('/custom', { schema: { query }, meta: { GET: { openapi: { parameters } } } }),
  ]);
  expect(doc.paths['/v1/api/custom']!.get).toMatchObject({ parameters });
});

it('combines intersected parameter constraints and oneOf branches through local refs', async () => {
  const validator = { safeParse: () => ({ success: true }) };
  const doc = await generateOpenAPI([route('/combined', { schema: { query: validator } })], {
    schemaToJSONSchema: () => ({
      $defs: {
        base: { type: 'object', properties: { term: { type: 'string' } }, required: ['term'] },
      },
      allOf: [
        { $ref: '#/$defs/base' },
        { type: 'object', properties: { term: { minLength: 2 } } },
        {
          oneOf: [
            {
              type: 'object',
              properties: { mode: { const: 'one' }, id: { type: 'string' } },
              required: ['mode', 'id'],
            },
            { type: 'object', properties: { mode: { const: 'all' } }, required: ['mode'] },
          ],
        },
        { required: ['mode'] },
      ],
    }),
  });
  const parameters = (
    doc.paths['/v1/api/combined']!.get as {
      parameters: Array<{ name: string; required: boolean; schema: unknown }>;
    }
  ).parameters;
  expect(parameters.map((p) => [p.name, p.required])).toEqual([
    ['term', true],
    ['mode', true],
    ['id', false],
  ]);
  expect(parameters[0]!.schema).toMatchObject({
    allOf: [
      { $ref: expect.stringContaining('/$defs/base/properties/term') },
      { $ref: expect.stringContaining('/allOf/1/properties/term') },
    ],
  });
});

it('documents array query keys with brackets so generated single- and multi-item requests validate', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-openapi-array-'));
  dirs.push(dir);
  const zod = JSON.stringify(createRequire(import.meta.url).resolve('zod'));
  fs.writeFileSync(
    path.join(dir, 'search.mjs'),
    `import {z} from ${zod}; export const schema={GET:{query:z.object({tags:z.array(z.string()).meta({id:'SearchTags'})})}};export const GET=(req,res)=>res.json(req.query);`,
  );
  const app = await createTestApp({ apiDir: dir });
  const doc = await generateOpenAPI(dir);
  const parameters = (doc.paths['/v1/api/search']!.get as { parameters: Array<{ name: string }> })
    .parameters;
  expect(parameters).toEqual([
    expect.objectContaining({ name: 'tags[]', style: 'form', explode: true, required: true }),
  ]);
  for (const tags of [['one'], ['one', 'two']]) {
    const query = new URLSearchParams(tags.map((tag) => [parameters[0]!.name, tag]));
    const res = await request(app).get('/v1/api/search?' + query);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tags });
  }
});

it('preserves external query field references without fetching or resolving them locally', async () => {
  const validator = { safeParse: () => ({ success: true }) };
  const external = 'https://schemas.example.org/email.json';
  const doc = await generateOpenAPI([route('/external', { schema: { query: validator } })], {
    schemaToJSONSchema: () => ({
      type: 'object',
      properties: {
        email: { $ref: external },
        tags: { type: 'array', $ref: 'https://schemas.example.org/tags.json' },
      },
    }),
  });
  expect(doc.components.schemas.EfcRequest1).toMatchObject({
    properties: { email: { $ref: external } },
  });
  expect(doc.paths['/v1/api/external']!.get).toMatchObject({
    parameters: [{ name: 'email' }, { name: 'tags[]', style: 'form', explode: true }],
  });
});

it('matches body requiredness to bodyless Express requests and honors explicit overrides', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-openapi-body-'));
  dirs.push(dir);
  const zod = JSON.stringify(createRequire(import.meta.url).resolve('zod'));
  fs.writeFileSync(
    path.join(dir, 'optional.mjs'),
    `import {z} from ${zod};export const schema={POST:{body:z.object({note:z.string().optional()}).optional()}};export const POST=(req,res)=>res.json({accepted:true});`,
  );
  fs.writeFileSync(
    path.join(dir, 'required.mjs'),
    `import {z} from ${zod};export const schema={POST:{body:z.object({note:z.string()})}};export const POST=(req,res)=>res.json({accepted:true});`,
  );
  const app = await createTestApp({ apiDir: dir });
  const doc = await generateOpenAPI(dir);
  expect((await request(app).post('/v1/api/optional')).status).toBe(200);
  expect(doc.paths['/v1/api/optional']!.post).toMatchObject({ requestBody: { required: false } });
  expect((await request(app).post('/v1/api/required')).status).toBe(400);
  expect(doc.paths['/v1/api/required']!.post).toMatchObject({ requestBody: { required: true } });
  const override = {
    required: false,
    content: { 'application/json': { schema: { type: 'object' } } },
  };
  const custom = await generateOpenAPI([
    route('/custom', {
      methods: ['POST'],
      schema: { body: z.object({ note: z.string() }) },
      meta: { POST: { openapi: { requestBody: override } } },
    }),
  ]);
  expect(custom.paths['/v1/api/custom']!.post).toMatchObject({ requestBody: override });
});

it('infers empty-body acceptance through refs and logical schemas without running validators', async () => {
  const validator = {
    safeParse: () => {
      throw new Error('must not execute during documentation generation');
    },
  };
  const schemas = [
    {
      json: {
        $defs: { Note: { type: 'object', properties: { note: { type: 'string' } } } },
        $ref: '#/$defs/Note',
      },
      required: false,
    },
    {
      json: { anyOf: [{ type: 'object', required: ['note'] }, { type: 'object' }] },
      required: false,
    },
    { json: { allOf: [{ type: 'object' }, { required: ['note'] }] }, required: true },
    { json: { oneOf: [{ type: 'object' }, { type: 'object' }] }, required: true },
    { json: { not: { type: 'object' } }, required: true },
    { json: { $ref: 'https://schemas.example.org/body.json' }, required: true },
    { json: { if: { type: 'object' }, then: { required: ['note'] }, else: {} }, required: true },
    { json: true, required: false },
    { json: false, required: true },
  ];
  for (const { json, required } of schemas) {
    const doc = await generateOpenAPI(
      [route('/body', { methods: ['POST'], schema: { body: validator } })],
      { schemaToJSONSchema: () => json },
    );
    expect(doc.paths['/v1/api/body']!.post).toMatchObject({ requestBody: { required } });
  }
});
