// Starts the published MCP server with `npx -y <spec>` over stdio, as an agent's client
// does, and checks it serves the bundled docs and tools.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [spec, version] = process.argv.slice(2);
const ok = (label) => console.log(`ok   ${label}`);
const fail = (label) => {
  console.log(`FAIL ${label}`);
  process.exit(1);
};

const client = new Client({ name: 'rehearsal', version: '1' });
await client.connect(
  new StdioClientTransport({ command: 'npx', args: ['-y', spec], env: process.env, stderr: 'inherit' }),
);
const server = client.getServerVersion();
server?.version === version ? ok(`npx -y ${spec} (server ${server.version})`) : fail(`server version ${server?.version}`);

const { resources } = await client.listResources();
resources.some((r) => r.uri === 'efc://docs/api-reference/table') && resources.length > 30
  ? ok(`${resources.length} docs resources`)
  : fail('docs resources');
const { tools } = await client.listTools();
['get-rules', 'get-doc', 'search-docs', 'resolve-route'].every((t) => tools.some((x) => x.name === t))
  ? ok(`${tools.length} tools`)
  : fail('tools');
const rules = await client.callTool({ name: 'get-rules', arguments: {} });
rules.content[0].text.includes('express-file-cluster/tasks') ? ok('get-rules') : fail('get-rules');
const doc = await client.callTool({ name: 'get-doc', arguments: { id: 'api-reference/table' } });
doc.content[0].text.startsWith('# defineTable') ? ok('get-doc api-reference/table') : fail('get-doc');
await client.close();
