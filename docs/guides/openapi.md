# OpenAPI generation (since 0.11.0)

Enable an OpenAPI 3.1 JSON document for your real HTTP routes:

```ts
ignite({
  ...config,
  openapi: {
    path: '/openapi.json',
    info: { title: 'My API', version: '1.0.0' },
  },
});
```

`openapi: true` uses `/openapi.json` and the project's package name/version. It is off by default. Global middleware applies to the document endpoint too. Its URL is reserved before API routing; a conflicting GET or HEAD route fails startup, including hidden routes, dynamic matches, case variants and trailing slashes. Import the JSON into an OpenAPI viewer or client generator.

The generator reads HTTP method exports, `meta`, and each method's request `schema`. Existing validation behavior stays the same. Validators that implement [Standard JSON Schema](https://standardschema.dev/json-schema) convert automatically using their input representation (including recent Zod 4 versions). A Standard Schema validator without JSON Schema support needs the `schemaToJSONSchema(validator)` adapter; enabling OpenAPI without one reports which route/location could not be converted. The adapter may be async. Runtime validation does not require JSON Schema support when OpenAPI is off.

```ts
// src/api/users/[id].ts
import { z } from 'zod';

export const schema = {
  GET: { params: z.object({ id: z.string().uuid() }) },
};
export const meta = {
  GET: {
    summary: 'Get a user',
    tags: ['users'],
    response: { status: 200, body: { id: 'example-id', name: 'Jane' } },
  },
};
export const GET = async (req, res) => {
  res.json({ id: req.params.id, name: 'Jane' });
};
```

Body schemas become JSON request bodies; object properties in query/params schemas become parameters. Named object schemas behind local `$ref` are resolved for parameter fields. Object unions/intersections (`anyOf`, `oneOf`, `allOf`) retain their fields; a union field is required only when every branch requires it. The operation’s `x-efc-query-schema` references the complete query schema, preserving constraints between fields that individual OpenAPI parameters cannot express. Non-object parameter schemas fail generation with the route/location; supply explicit `meta.METHOD.openapi.parameters` to document a custom representation. Object query fields use `style: deepObject` and `explode: true`, matching Express bracket syntax such as `?filter[name]=Alice`. Nested `$defs` and local JSON Schema pointers are rebased into components; explicit `$id` resource scopes keep their local-reference semantics. Example request headers/query/body and response status/body come from `meta`. A request-validation 400 response is documented. Response schemas, alternative content types and authorization requirements can be supplied explicitly with `meta.METHOD.openapi` (an OpenAPI Operation Object). Auth middleware is not inspected to infer security policy.

```ts
// In ignite options:
openapi: {
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
}
// In a route:
export const meta = {
  GET: { openapi: { security: [{ bearerAuth: [] }] } },
};
```

`meta.GET.openapi.hidden: true` omits an operation. `summary`, `tags`, `description` and `operationId` are also supported directly in `meta.GET`. Explicit IDs must be unique; optional URL expansions get an index suffix. The document includes `basePath`. Optional URL segments expand into separate paths so every documented path parameter is required, as [OpenAPI requires](https://spec.openapis.org/oas/v3.1.0). Equivalent optional expansions use Express’s greedy binding (`[[first]]/[[second]]` with one segment binds `first`); other routes with equivalent templates but different parameter names fail generation rather than emitting an invalid document. Catch-all paths carry `x-efc-catch-all: true`: their slash-separated URL semantics need client-specific handling. WebSocket-only routes do not appear as HTTP operations.

For offline use, call `await generateOpenAPI('/absolute/path/to/src/api', { basePath, ...options })`, then write the returned object as JSON. This scans and imports route modules but does not listen, execute handlers or boot services; use the same TS loader/build output as the app, and keep service startup out of route module top-level code. Advanced callers can pass loaded `MountedRoute[]` directly instead. Plain `scanDir()` entries do not contain loaded HTTP exports/schemas. The `/testing` helper accepts the same `openapi` option for document tests.

Array query fields use bracketed wire names (`tags[]`) with `style: form` and `explode: true`, so one item and repeated items both reach Express as arrays. For example, `?tags[]=one&tags[]=two` becomes `req.query.tags`. An empty array has no entries to serialize; use an optional query field when omission is allowed. External field `$ref` values are preserved without network requests; provide a local `type` hint or explicit operation parameters if their object/array serialization cannot be inferred. Root parameter objects still need an inspectable local shape or explicit parameters.

Request-body requiredness follows whether the converted JSON Schema accepts the empty object Express supplies for a missing body. Required properties keep the body mandatory; optional object bodies allow omission. Local references and logical schema combinations are considered without executing application validators. Unknown external/dynamic body references remain required conservatively. Use `meta.METHOD.openapi.requestBody` to override inference, especially when middleware changes the body or validation uses custom rules. A body example alone does not make a body required.
