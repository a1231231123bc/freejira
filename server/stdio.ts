import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
const url = process.env.FREEJIRA_URL || 'http://127.0.0.1:4173';
const token = process.env.FREEJIRA_TOKEN;
if (!token) {
  console.error('Set FREEJIRA_TOKEN to a token created in Freejira → MCP & AI.');
  process.exit(1);
}
const remote = new Client({ name: 'freejira-stdio', version: '1.0.0' });
await remote.connect(
  new StreamableHTTPClientTransport(new URL('/mcp', url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }),
);
const local = new Server(
  { name: 'freejira', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {} } },
);
local.setRequestHandler(ListToolsRequestSchema, () => remote.listTools());
local.setRequestHandler(CallToolRequestSchema, (request) => remote.callTool(request.params));
local.setRequestHandler(ListResourcesRequestSchema, () => remote.listResources());
local.setRequestHandler(ReadResourceRequestSchema, (request) =>
  remote.readResource(request.params),
);
await local.connect(new StdioServerTransport());
process.stdin.on('end', () => {
  void remote.close();
  void local.close();
});
