// POC smoke test: connects to the built server over stdio and HTTP in both protocol eras.
// Usage: node tests/smoke/v2Smoke.mts <stdio|http> <legacy|modern> [httpUrl]
// With ADMIN_TOOLS_ENABLED=true it also runs update-user, answering its elicitation with "yes".
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const [transportKind = 'stdio', era = 'modern', httpUrl = 'http://127.0.0.1:3927/tableau-mcp'] =
  process.argv.slice(2);

const client = new Client(
  { name: 'v2-smoke', version: '0.0.0' },
  {
    capabilities: { elicitation: { form: {} } },
    ...(era === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {}),
  },
);

let elicitations = 0;
client.setRequestHandler('elicitation/create', async (request) => {
  elicitations++;
  console.log('elicitation:', request.params.message);
  return { action: 'accept', content: { confirm: true } };
});

const transport =
  transportKind === 'stdio'
    ? new StdioClientTransport({
        command: 'node',
        args: ['build/index.js'],
        env: { ...process.env, TRANSPORT: 'stdio' } as Record<string, string>,
        stderr: 'inherit',
      })
    : new StreamableHTTPClientTransport(new URL(httpUrl));

await client.connect(transport);
console.log('era:', client.getProtocolEra(), 'version:', client.getNegotiatedProtocolVersion());
console.log('server:', client.getServerVersion());

const { tools } = await client.listTools();
console.log(
  `tools/list: ${tools.length} tools`,
  tools.slice(0, 5).map((t) => t.name),
);

const { prompts } = await client.listPrompts().catch((e) => ({ prompts: [], error: e }));
console.log(`prompts/list: ${prompts.length}`);

const target = tools.find((t) => t.name === 'list-datasources') ?? tools[0];
if (target) {
  const result = await client.callTool({ name: target.name, arguments: {} });
  const first = (result.content as Array<{ type: string; text?: string }>)[0];
  console.log(`tools/call ${target.name}: isError=${result.isError}`, first?.text?.slice(0, 200));
}

const updateUser = tools.find((t) => t.name === 'update-user');
if (updateUser) {
  const result = await client.callTool({
    name: 'update-user',
    arguments: { userId: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890', siteRole: 'Viewer' },
  });
  const first = (result.content as Array<{ type: string; text?: string }>)[0];
  console.log(
    `tools/call update-user: elicitations=${elicitations} isError=${result.isError}`,
    first?.text,
  );
}

await client.close();
