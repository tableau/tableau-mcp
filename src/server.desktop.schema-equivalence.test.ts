import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { getDesktopConfig } from './config.desktop.js';
import { buildDesktopInstructions } from './desktop/instructions.js';
import {
  COMPLETE_REQUEST_BIND_CAPABILITY_KEY,
  COMPLETE_REQUEST_BIND_CAPABILITY_VERSION,
  DesktopMcpServer,
  getDesktopToolListEntry,
  STRICT_SESSION_SCOPE_CAPABILITY_KEY,
  STRICT_SESSION_SCOPE_CAPABILITY_VERSION,
} from './server.desktop.js';
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

describe('Desktop strict-session initialize capability', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(['standalone', 'shared'] as const)(
    'advertises the canonical strict target through the actual %s initialize response',
    async (mode) => {
      vi.stubEnv('TABLEAU_DESKTOP_SESSION_SCOPE', 'strict');
      vi.stubEnv('TABLEAU_DESKTOP_SESSION_ID', '004242');
      const sharedServer = new McpServer(
        { name: 'shared', version: '0.0.0' },
        {
          instructions: buildDesktopInstructions({
            sessionPinned: true,
            sessionScope: 'strict',
            profile: getDesktopConfig().toolProfile,
          }),
        },
      );
      const desktopServer =
        mode === 'standalone'
          ? new DesktopMcpServer()
          : new DesktopMcpServer({ mcpServer: sharedServer });
      const sdkServer = mode === 'standalone' ? desktopServer.mcpServer : sharedServer;
      const client = new Client({ name: 'strict-capability-client', version: '0.0.0' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

      try {
        await sdkServer.connect(serverTransport);
        await client.connect(clientTransport);

        expect(client.getServerCapabilities()?.experimental).toEqual({
          [STRICT_SESSION_SCOPE_CAPABILITY_KEY]: {
            version: STRICT_SESSION_SCOPE_CAPABILITY_VERSION,
            mode: 'strict',
            sessionId: '4242',
          },
          tableauDesktopBindTemplateCompletion: {
            version: 1,
            tool: 'bind-template',
            resultKind: 'single_sheet_apply',
          },
          [COMPLETE_REQUEST_BIND_CAPABILITY_KEY]: {
            version: COMPLETE_REQUEST_BIND_CAPABILITY_VERSION,
            tool: 'bind-template',
            templates: [
              'ranking-ordered-bar',
              'trend-line-chart',
              'correlation-scatter-plot-chart',
            ],
          },
        });
      } finally {
        await client.close();
        await sdkServer.close();
      }
    },
  );

  it('does not add the strict-session capability in ordinary mode', async () => {
    const desktopServer = new DesktopMcpServer();
    const client = new Client({ name: 'ordinary-capability-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await desktopServer.mcpServer.connect(serverTransport);
      await client.connect(clientTransport);

      expect(client.getServerCapabilities()?.experimental).toBeUndefined();
    } finally {
      await client.close();
      await desktopServer.mcpServer.close();
    }
  });

  it.each(['standalone', 'shared'] as const)(
    'advertises an exact workspace guard in %s strict mode without changing the completion capability',
    async (mode) => {
      vi.stubEnv('TABLEAU_DESKTOP_SESSION_SCOPE', 'strict');
      vi.stubEnv('TABLEAU_DESKTOP_SESSION_ID', '4242');
      const target = { workbookTitle: 'Sales', sheetId: 'sheet-1', sheetName: 'Overview' };
      vi.stubEnv('TABLEAU_DESKTOP_EXPECTED_WORKSPACE', JSON.stringify(target));
      const sharedServer = new McpServer(
        { name: 'shared', version: '0.0.0' },
        {
          instructions: buildDesktopInstructions({
            sessionPinned: true,
            sessionScope: 'strict',
            profile: getDesktopConfig().toolProfile,
          }),
        },
      );
      const desktopServer =
        mode === 'standalone'
          ? new DesktopMcpServer()
          : new DesktopMcpServer({ mcpServer: sharedServer });
      const sdkServer = mode === 'standalone' ? desktopServer.mcpServer : sharedServer;
      const client = new Client({ name: 'workspace-capability-client', version: '0.0.0' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      try {
        await sdkServer.connect(serverTransport);
        await client.connect(clientTransport);
        expect(client.getServerCapabilities()?.experimental).toMatchObject({
          tableauDesktopBindTemplateCompletion: {
            version: 1,
            tool: 'bind-template',
            resultKind: 'single_sheet_apply',
          },
          tableauDesktopWorkspaceGuard: { version: 1, target },
        });
      } finally {
        await client.close();
        await sdkServer.close();
      }
    },
  );
});
