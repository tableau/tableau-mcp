import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { DesktopMcpServer, getDesktopToolListEntry } from './server.desktop.js';
import type { DesktopTool } from './tools/desktop/tool.js';
import { desktopToolFactories } from './tools/desktop/tools.js';
import { Provider } from './utils/provider.js';

vi.unmock('@modelcontextprotocol/sdk/server/mcp.js');

function normalizeSdkTool(tool: Tool): Tool {
  const normalized = structuredClone(tool) as Tool & {
    inputSchema: Tool['inputSchema'] & { $schema?: string };
  };
  delete normalized.inputSchema.$schema;
  delete normalized._meta;
  delete normalized.execution;
  const annotations = normalized.annotations;
  if (annotations && annotations.title === normalized.title) {
    delete annotations.title;
  }
  return normalized;
}

describe('getDesktopToolListEntry SDK schema equivalence', () => {
  it('matches the SDK registration path for representative desktop schemas', async () => {
    const desktopServer = new DesktopMcpServer();
    const representativeNames = new Set(['list-instances', 'ask-user', 'bind-template']);
    const tools = desktopToolFactories
      .map((factory) => factory(desktopServer))
      .filter((tool) => representativeNames.has(tool.name));
    const sdkServer = new McpServer({ name: 'schema-equivalence', version: '0.0.0' });
    const client = new Client({ name: 'schema-equivalence-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    for (const tool of tools) {
      sdkServer.registerTool(
        tool.name,
        {
          title: await Provider.from(tool.title),
          description: await Provider.from(tool.description),
          inputSchema: await Provider.from(tool.paramsSchema),
          annotations: await Provider.from(tool.annotations),
        },
        async () => ({ content: [] }),
      );
    }

    try {
      await sdkServer.connect(serverTransport);
      await client.connect(clientTransport);
      const sdkTools = (await client.listTools()).tools;

      expect(tools.map((tool) => tool.name).sort()).toEqual([...representativeNames].sort());
      for (const tool of tools) {
        const sdkTool = sdkTools.find((candidate) => candidate.name === tool.name);
        expect(sdkTool).toBeDefined();
        expect(await getDesktopToolListEntry(tool as DesktopTool<any>)).toEqual(
          normalizeSdkTool(sdkTool!),
        );
      }
    } finally {
      await client.close();
      await sdkServer.close();
    }
  });
});
