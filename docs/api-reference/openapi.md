# OpenAPI API (since 0.11.0)

Exported from `express-file-cluster`:

```ts
generateOpenAPI(
  routes: MountedRoute[] | string, // explicit API directory or already loaded metadata
  options?: OpenAPIOptions & { basePath?: string },
): Promise<OpenAPIDocument>
```

`OpenAPIDocument` contains `openapi: '3.1.0'`, `info`, `paths`, `components.schemas`, and optional `servers`. A directory argument scans/imports route files. A loaded-route argument uses existing metadata. Generation uses HTTP methods, metadata and request schemas. It does not change validation or execute handlers.

`ignite({ openapi: true | OpenAPIOptions })` and `createTestApp({ openapi: true | OpenAPIOptions })` generate once and serve the document. Default: disabled.

| Option | Default | Purpose |
|---|---|---|
| `path?: string` | `/openapi.json` | Absolute static document URL; reserved before API routes. |
| `info?: { title; version; description? }` | project package metadata in ignite; EFC API/1.0.0 in standalone/testing | Required OpenAPI info. |
| `servers?: { url; description? }[]` | omitted | Deployment URLs. |
| `components?: Record<string, unknown>` | generated schemas | Explicit components such as security schemes; generated component names avoid collisions. |
| `schemaToJSONSchema?: (validator: Validator) => JSONSchema \| Promise<JSONSchema>` | Standard JSON Schema input conversion | Adapter for validators without the standard JSON Schema protocol. |

`JSONSchema = boolean | Record<string, unknown>`. `RouteMethodMeta` adds `summary`, `tags`, `operationId`, and `openapi: Record<string, unknown> & { hidden?: boolean }`. The explicit operation fields override generated defaults; author-supplied OpenAPI objects must be valid. Only `hidden` is stripped. IDs are normalized for optional path expansions and duplicates are rejected.

See [the guide](../guides/openapi.md) for conversion, security and catch-all semantics.

The CommonJS generator delegates asynchronously to the ESM implementation, preserving native ESM route imports (including top-level await). It has the same Promise return type in both formats.

Document URL collisions are checked against actual GET/HEAD route matchers before hidden operations are filtered. Equivalent optional path variants are collapsed using the first parameter binding; ambiguous templates across routes throw.

Query/params object combinators are expanded into parameter fields. Unions retain branch-specific fields as optional and require only fields required by every branch; intersections combine requirements. `x-efc-query-schema` points to the full query schema for cross-field constraints. Object query fields use `deepObject` with `explode: true`. Non-object parameter shapes require explicit `meta.METHOD.openapi.parameters`; generation otherwise reports the route and location instead of omitting inputs.

Array query parameters expose the bracketed wire name (`tags[]`), `style: form`, and `explode: true`; the request property remains `tags`. External field references are retained without fetching, and explicit local type hints enable object/array style inference. Uninspectable root parameter objects still require explicit operation parameters.

`requestBody.required` is inferred from whether the converted schema accepts `{}`, the missing-body value supplied by Express. Local refs and logical constraints are evaluated without running validators; unresolved external/dynamic references conservatively remain required. Explicit `meta.METHOD.openapi.requestBody` overrides this inference. Example-only bodies are optional.
