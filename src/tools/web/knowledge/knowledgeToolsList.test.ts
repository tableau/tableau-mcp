import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getInspectKnowledgeContextTool } from './inspectKnowledgeContext.js';
import { getManageKnowledgeContextTool } from './manageKnowledgeContext.js';
import { getQueryKnowledgeContextTool } from './queryKnowledgeContext.js';

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: vi.fn().mockResolvedValue(true) })),
}));

type AdvertisedSchema = {
  properties?: Record<string, { enum?: unknown[] }>;
  required?: string[];
};

// testSetup.ts globally mocks McpServer; the real one is needed to exercise the SDK's own
// tools/list schema conversion, which is where the empty `properties: {}` came from.
async function listKnowledgeTools(): Promise<Map<string, AdvertisedSchema>> {
  const { McpServer } = await vi.importActual<
    typeof import('@modelcontextprotocol/sdk/server/mcp.js')
  >('@modelcontextprotocol/sdk/server/mcp.js');
  const mcpServer = new McpServer({ name: 'test', version: '0.0.0' });
  const server = new WebMcpServer();
  const tools = [
    getQueryKnowledgeContextTool(server),
    getInspectKnowledgeContextTool(server),
    getManageKnowledgeContextTool(server),
  ];
  for (const tool of tools) {
    mcpServer.registerTool(
      tool.name,
      {
        description: await Provider.from(tool.description),
        inputSchema: await Provider.from(tool.paramsSchema),
      },
      async () => ({ content: [] }),
    );
  }

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)]);
  const { tools: listed } = await client.listTools();
  await client.close();

  return new Map(listed.map((tool) => [tool.name, tool.inputSchema as AdvertisedSchema]));
}

describe('knowledge tools over tools/list', () => {
  it.each([
    [
      'query-knowledge-context',
      'intent',
      ['ground', 'relationships', 'lineage', 'impact', 'sources'],
    ],
    ['inspect-knowledge-context', 'action', ['status', 'list', 'suggestions']],
    ['manage-knowledge-context', 'action', ['create', 'update', 'delete']],
  ] as const)(
    '%s advertises a non-empty schema with a required %s enum',
    async (name, key, values) => {
      const schema = (await listKnowledgeTools()).get(name);

      expect(Object.keys(schema?.properties ?? {}).length).toBeGreaterThan(1);
      expect(schema?.required).toContain(key);
      expect(schema?.properties?.[key]?.enum).toEqual(values);
    },
  );
});
