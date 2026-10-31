import { Router, type Express, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { scanDir } from './router/scan.js';
import type { MountedRoute, Validator } from './types.js';
import { schemaFor } from './router/validate.js';

export type JSONSchema = boolean | Record<string, unknown>;
export interface OpenAPIOptions {
  /** Absolute static URL for the document. Default /openapi.json. */
  path?: string;
  info?: { title: string; version: string; description?: string };
  servers?: Array<{ url: string; description?: string }>;
  components?: Record<string, unknown>;
  /** Adapter for validators without Standard JSON Schema support. */
  schemaToJSONSchema?: (validator: Validator) => JSONSchema | Promise<JSONSchema>;
}
export interface OpenAPIDocument {
  openapi: '3.1.0';
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, unknown>>;
  components: Record<string, unknown> & { schemas: Record<string, JSONSchema> };
  servers?: Array<{ url: string; description?: string }>;
}
const pointer = (value: string) => value.replace(/~/g, '~0').replace(/\//g, '~1');
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Expand optional URL segments: OpenAPI requires every path parameter to be present. */
function variants(url: string): string[] {
  let paths = [''];
  for (const segment of url.split('/').filter(Boolean)) {
    const optional = /^:([\w$]+)(\*)?\?$/.test(segment);
    const formatted = segment.replace(/:([\w$]+)\*?\??/g, '{$1}');
    paths = paths.flatMap((path) =>
      optional ? [path + '/' + formatted, path] : [path + '/' + formatted],
    );
    if (paths.length > 256) throw new Error('[EFC] OpenAPI: too many optional path variants');
  }
  // Express greedily fills earlier optional parameters. Keep that binding when
  // several expansions describe the same URL shape, which OAS cannot duplicate.
  const shapes = new Set<string>();
  return paths
    .map((path) => path || '/')
    .filter((path) => {
      const shape = path.replace(/\{[^}]+\}/g, '{}');
      if (shapes.has(shape)) return false;
      shapes.add(shape);
      return true;
    });
}
function rebase(value: unknown, root: string, resource = false): unknown {
  if (Array.isArray(value)) return value.map((child) => rebase(child, root, resource));
  const object = record(value);
  if (!object) return value;
  resource = resource || typeof object.$id === 'string';
  const maps = new Set([
    'properties',
    'patternProperties',
    '$defs',
    'definitions',
    'dependentSchemas',
  ]);
  const children = new Set([
    'items',
    'additionalProperties',
    'contains',
    'propertyNames',
    'not',
    'if',
    'then',
    'else',
    'unevaluatedProperties',
    'unevaluatedItems',
    'contentSchema',
    'allOf',
    'anyOf',
    'oneOf',
    'prefixItems',
  ]);
  return Object.fromEntries(
    Object.entries(object).map(([key, child]) => {
      if (
        !resource &&
        (key === '$ref' || key === '$dynamicRef') &&
        typeof child === 'string' &&
        (child === '#' || child.startsWith('#/'))
      )
        return [key, root + child.slice(1)];
      if (maps.has(key) && record(child))
        return [
          key,
          Object.fromEntries(
            Object.entries(child as Record<string, unknown>).map(([name, schema]) => [
              name,
              rebase(schema, root, resource),
            ]),
          ),
        ];
      return [key, children.has(key) ? rebase(child, root, resource) : child];
    }),
  );
}

interface ParameterField {
  schema: JSONSchema;
  object: boolean;
  array: boolean;
}
interface ParameterShape {
  properties: Map<string, ParameterField>;
  required: Set<string>;
}

function parameterObject(schema: JSONSchema | undefined, rootRef: string): ParameterShape {
  const empty = (): ParameterShape => ({ properties: new Map(), required: new Set() });
  if (schema === undefined) return empty();
  const target = (ref: string): unknown => {
    if (!ref.startsWith('#/')) throw new Error('parameter schemas need local JSON pointers');
    let value: unknown = schema;
    for (const part of ref.slice(2).split('/')) {
      const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
      const object = record(value);
      // Arrays occur in pointers into anyOf/allOf/oneOf branches.
      value = Array.isArray(value)
        ? value[Number(key)]
        : object && Object.hasOwn(object, key)
          ? object[key]
          : undefined;
    }
    return value;
  };
  const hasType = (value: unknown, type: 'object' | 'array', seen = new Set<string>()): boolean => {
    const object = record(value);
    if (!object) return false;
    if (object.type === type || (type === 'object' && object.properties)) return true;
    if (typeof object.$ref === 'string' && object.$ref.startsWith('#/') && !seen.has(object.$ref)) {
      return hasType(target(object.$ref), type, new Set([...seen, object.$ref]));
    }
    return ['allOf', 'anyOf', 'oneOf'].some(
      (key) =>
        Array.isArray(object[key]) &&
        object[key].some((child: unknown) => hasType(child, type, seen)),
    );
  };
  const merge = (shapes: ParameterShape[], mode: 'allOf' | 'anyOf'): ParameterShape => {
    const result = empty();
    const names = new Set(shapes.flatMap((shape) => [...shape.properties.keys()]));
    for (const name of names) {
      const fields = shapes.flatMap((shape) => {
        const field = shape.properties.get(name);
        return field ? [field] : [];
      });
      result.properties.set(name, {
        schema:
          fields.length === 1 ? fields[0]!.schema : { [mode]: fields.map((field) => field.schema) },
        object: fields.some((field) => field.object),
        array: fields.some((field) => field.array),
      });
    }
    const required = new Set(shapes.flatMap((shape) => [...shape.required]));
    for (const name of required) {
      if (mode === 'allOf' || shapes.every((shape) => shape.required.has(name)))
        result.required.add(name);
    }
    return result;
  };
  const visit = (value: unknown, fragment: string, seen: Set<string>): ParameterShape => {
    const object = record(value);
    if (!object) throw new Error('query/params schemas must describe objects');
    const shapes: ParameterShape[] = [];
    const properties = record(object.properties);
    if (properties || object.type === 'object' || Array.isArray(object.required)) {
      const direct = empty();
      for (const [name, child] of Object.entries(properties ?? {})) {
        direct.properties.set(name, {
          schema: { $ref: rootRef + fragment + '/properties/' + pointer(name) },
          object: hasType(child, 'object'),
          array: hasType(child, 'array'),
        });
      }
      if (Array.isArray(object.required)) {
        for (const name of object.required) if (typeof name === 'string') direct.required.add(name);
      }
      shapes.push(direct);
    }
    if (typeof object.$ref === 'string') {
      if (seen.has(object.$ref)) throw new Error('cyclic parameter object reference');
      shapes.push(
        visit(target(object.$ref), object.$ref.slice(1), new Set([...seen, object.$ref])),
      );
    }
    for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
      const branches = object[key];
      if (!Array.isArray(branches) || !branches.length) continue;
      shapes.push(
        merge(
          branches.map((branch, index) => visit(branch, fragment + '/' + key + '/' + index, seen)),
          key === 'allOf' ? 'allOf' : 'anyOf',
        ),
      );
    }
    if (!shapes.length)
      throw new Error(
        'query/params schemas must describe objects; use explicit openapi.parameters for other shapes',
      );
    return merge(shapes, 'allOf');
  };
  return visit(schema, '', new Set());
}

/** Missing JSON bodies are {} after Express's parsers. Unknown external refs
 * remain conservative; explicit requestBody metadata can override requiredness. */
function acceptsEmptyObject(
  schema: JSONSchema,
  root = schema,
  seen = new Set<string>(),
): boolean | undefined {
  if (typeof schema === 'boolean') return schema;
  if (schema !== root && typeof schema.$id === 'string') {
    root = schema;
    seen = new Set();
  }
  const results: Array<boolean | undefined> = [];
  if (typeof schema.$dynamicRef === 'string') results.push(undefined);
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    results.push(types.includes('object'));
  }
  const isEmpty = (value: unknown) => !!record(value) && Object.keys(value as object).length === 0;
  if ('const' in schema) results.push(isEmpty(schema.const));
  if (Array.isArray(schema.enum)) results.push(schema.enum.some(isEmpty));
  if (Array.isArray(schema.required)) results.push(schema.required.length === 0);
  if (typeof schema.minProperties === 'number') results.push(schema.minProperties <= 0);
  if (typeof schema.$ref === 'string') {
    const ref = schema.$ref;
    if ((!ref.startsWith('#/') && ref !== '#') || seen.has(ref)) results.push(undefined);
    else {
      let target: unknown = root;
      for (const part of ref === '#' ? [] : ref.slice(2).split('/')) {
        const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
        target = Array.isArray(target) ? target[Number(key)] : record(target)?.[key];
      }
      results.push(
        typeof target === 'boolean' || record(target)
          ? acceptsEmptyObject(target as JSONSchema, root, new Set([...seen, ref]))
          : undefined,
      );
    }
  }
  for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
    if (!Array.isArray(schema[key])) continue;
    const values = schema[key].map((child: JSONSchema) => acceptsEmptyObject(child, root, seen));
    if (key === 'allOf')
      results.push(values.includes(false) ? false : values.includes(undefined) ? undefined : true);
    if (key === 'anyOf')
      results.push(values.includes(true) ? true : values.includes(undefined) ? undefined : false);
    if (key === 'oneOf')
      results.push(
        values.filter((value) => value === true).length > 1
          ? false
          : values.includes(undefined)
            ? undefined
            : values.filter((value) => value === true).length === 1,
      );
  }
  if (typeof schema.not === 'boolean' || record(schema.not)) {
    const value = acceptsEmptyObject(schema.not as JSONSchema, root, seen);
    results.push(value === undefined ? undefined : !value);
  }
  if (typeof schema.if === 'boolean' || record(schema.if)) {
    const condition = acceptsEmptyObject(schema.if as JSONSchema, root, seen);
    const branch = (key: 'then' | 'else') =>
      typeof schema[key] === 'boolean' || record(schema[key])
        ? acceptsEmptyObject(schema[key] as JSONSchema, root, seen)
        : true;
    results.push(
      condition === undefined
        ? branch('then') === branch('else')
          ? branch('then')
          : undefined
        : branch(condition ? 'then' : 'else'),
    );
  }
  return results.includes(false) ? false : results.includes(undefined) ? undefined : true;
}

/** Generate a document from the same mounted route exports used by the HTTP router. */
export async function generateOpenAPI(
  input: MountedRoute[] | string,
  options: OpenAPIOptions & { basePath?: string } = {},
): Promise<OpenAPIDocument> {
  let routes: MountedRoute[];
  if (typeof input === 'string') {
    if (!input.trim() || !fs.existsSync(input) || !fs.statSync(input).isDirectory())
      throw new Error('[EFC] OpenAPI apiDir must be an existing directory');
    routes = [];
    for (const route of scanDir(path.resolve(input))) {
      const mod = (await import(route.filePath)) as Record<string, unknown>;
      routes.push({
        ...route,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].filter(
          (method) => typeof mod[method] === 'function',
        ),
        ...(record(mod.meta) && { meta: mod.meta as NonNullable<MountedRoute['meta']> }),
        ...(record(mod.schema) && { schema: mod.schema as NonNullable<MountedRoute['schema']> }),
      });
    }
  } else routes = input;
  const schemas: Record<string, JSONSchema> = {
    ...(record(options.components?.schemas) as Record<string, JSONSchema> | undefined),
  };
  const doc: OpenAPIDocument = {
    openapi: '3.1.0',
    info: options.info ?? { title: 'EFC API', version: '1.0.0' },
    paths: {},
    components: { ...options.components, schemas },
    ...(options.servers && { servers: options.servers }),
  };
  const prefix = (options.basePath ?? '/v1/api').replace(/\/+$/, '');
  const ids = new Set<string>();
  const pathShapes = new Map<string, string>();
  let sequence = 0;
  const convert = async (validator: Validator, label: string) => {
    const standard = (
      validator as {
        '~standard'?: { jsonSchema?: { input?: (options: { target: string }) => unknown } };
      }
    )['~standard'];
    let converted: unknown;
    try {
      if (standard?.jsonSchema?.input)
        converted = await standard.jsonSchema.input({ target: 'draft-2020-12' });
      else if (options.schemaToJSONSchema) converted = await options.schemaToJSONSchema(validator);
      else throw new Error('validator needs Standard JSON Schema support or schemaToJSONSchema');
    } catch (error) {
      throw new Error(`[EFC] OpenAPI ${label}: ${(error as Error).message}`, { cause: error });
    }
    if (typeof converted !== 'boolean' && !record(converted))
      throw new Error(`[EFC] OpenAPI ${label}: invalid JSON Schema`);
    let name: string;
    do {
      name = 'EfcRequest' + ++sequence;
    } while (Object.hasOwn(schemas, name));
    const ref = '#/components/schemas/' + pointer(name);
    schemas[name] = rebase(converted, ref) as JSONSchema;
    return { ref, schema: converted as JSONSchema };
  };
  for (const route of routes) {
    const paths = variants(prefix + (route.urlPath === '/' ? '' : route.urlPath));
    for (const method of route.methods) {
      const meta = route.meta?.[method];
      const explicit = meta?.openapi ?? {};
      if (explicit.hidden) continue;
      const request = schemaFor(route.schema, method);
      const roots: Partial<
        Record<'params' | 'query' | 'body', Awaited<ReturnType<typeof convert>>>
      > = {};
      for (const location of ['params', 'query', 'body'] as const) {
        if (request?.[location])
          roots[location] = await convert(
            request[location]!,
            `${method} ${route.urlPath} ${location}`,
          );
      }
      for (const [index, path] of paths.entries()) {
        const shape = path.replace(/\{[^}]+\}/g, '{}');
        const previous = pathShapes.get(shape);
        if (previous && previous !== path)
          throw new Error(`[EFC] OpenAPI: ambiguous paths ${previous} and ${path}`);
        pathShapes.set(shape, path);
        const item = (doc.paths[path] ??= {});
        if (Object.hasOwn(item, method.toLowerCase())) continue; // Router precedence: first handler wins.
        const pathNames = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!);
        const parameters: Record<string, unknown>[] = [];
        for (const location of ['params', 'query'] as const) {
          if (explicit.parameters !== undefined) break;
          const root = roots[location];
          let fields: ParameterShape;
          try {
            fields = parameterObject(root?.schema, root?.ref ?? '');
          } catch (error) {
            throw new Error(
              `[EFC] OpenAPI ${method} ${route.urlPath} ${location}: ${(error as Error).message}`,
              { cause: error },
            );
          }
          const { properties, required } = fields;
          const names =
            location === 'params'
              ? pathNames
              : [...new Set([...properties.keys(), ...Object.keys(meta?.request?.query ?? {})])];
          for (const name of names) {
            const field = properties.get(name);
            parameters.push({
              // Brackets keep one-element arrays as arrays in Express's query parser.
              name: location === 'query' && field?.array ? name + '[]' : name,
              in: location === 'params' ? 'path' : 'query',
              required: location === 'params' || required.has(name),
              schema: field?.schema ?? { type: 'string' },
              ...(location === 'query' && field?.object && { style: 'deepObject', explode: true }),
              ...(location === 'query' && field?.array && { style: 'form', explode: true }),
              ...(meta?.request?.[location]?.[name] !== undefined && {
                example: meta.request[location]![name],
              }),
            });
          }
        }
        for (const [name, example] of Object.entries(meta?.request?.headers ?? {})) {
          parameters.push({ name, in: 'header', schema: { type: 'string' }, example });
        }
        const requestedId =
          typeof explicit.operationId === 'string' ? explicit.operationId : meta?.operationId;
        const baseId =
          (requestedId ?? `${method.toLowerCase()}_${path.replace(/[^a-zA-Z0-9_]/g, '_')}`) +
          (requestedId && paths.length > 1 ? '_' + index : '');
        let id = baseId;
        if (requestedId && ids.has(id))
          throw new Error(`[EFC] OpenAPI: duplicate operationId ${id}`);
        let suffix = 2;
        while (ids.has(id)) id = baseId + '_' + suffix++;
        ids.add(id);
        const status = String(meta?.response?.status ?? 200);
        const response = {
          description: 'Response',
          ...(meta?.response?.body !== undefined && {
            content: { 'application/json': { example: meta.response.body } },
          }),
        };
        const overrides = { ...explicit };
        delete overrides.hidden;
        delete overrides.operationId;
        item[method.toLowerCase()] = {
          operationId: id,
          ...(meta?.description && { description: meta.description }),
          ...(meta?.summary && { summary: meta.summary }),
          ...(meta?.tags && { tags: meta.tags }),
          ...(parameters.length && { parameters }),
          ...(roots.query && { 'x-efc-query-schema': { $ref: roots.query.ref } }),
          ...((roots.body || meta?.request?.body !== undefined) && {
            requestBody: {
              required: roots.body ? acceptsEmptyObject(roots.body.schema) !== true : false,
              content: {
                'application/json': {
                  ...(roots.body && { schema: { $ref: roots.body.ref } }),
                  ...(meta?.request?.body !== undefined && { example: meta.request.body }),
                },
              },
            },
          }),
          responses: {
            [status]: response,
            ...(request &&
              status !== '400' && { '400': { description: 'Request validation failed' } }),
          },
          ...(route.urlPath.includes('*') && { 'x-efc-catch-all': true }),
          ...overrides,
        };
      }
    }
  }
  return doc;
}

export async function mountOpenAPI(
  app: Express,
  routes: MountedRoute[],
  options: OpenAPIOptions & { basePath?: string },
) {
  const path = options.path ?? '/openapi.json';
  if (!path.startsWith('/') || /[?*:[\](){}#]/.test(path))
    throw new Error('[EFC] openapi.path must be an absolute static URL path');
  // Probe the actual Express matchers before filtering hidden operations. This
  // also respects case/trailing-slash rules, dynamic routes and implicit HEAD.
  const conflict = await new Promise<boolean>((resolve, reject) => {
    const probe = Router();
    const api = Router();
    for (const route of routes) {
      if (route.methods.some((method) => method === 'GET' || method === 'HEAD'))
        api.get(route.pattern ?? route.urlPath, (_req, _res) => resolve(true));
    }
    probe.use(options.basePath ?? '/v1/api', api);
    probe({ method: 'GET', url: path } as Request, {} as Response, (error?: unknown) => {
      if (error) reject(error);
      else resolve(false);
    });
  });
  if (conflict) throw new Error(`[EFC] OpenAPI URL conflicts with a GET/HEAD route: ${path}`);
  const document = await generateOpenAPI(routes, options);
  app.get(path, (req, res, next) => {
    if (req.headers.upgrade) return next();
    res.json(document);
  });
  return document;
}
