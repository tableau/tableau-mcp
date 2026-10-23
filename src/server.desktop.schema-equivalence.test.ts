import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { getDesktopConfig } from './config.desktop.js';
import { buildDesktopInstructions } from './desktop/instructions.js';
import * as loggerModule from './logging/logger.js';
import {
  ALWAYS_LOAD_TOOL_NAMES,
  DesktopMcpServer,
  getDesktopToolListEntry,
  getModelFacingToolEntry,
} from './server.desktop.js';
import type { DesktopTool } from './tools/desktop/tool.js';
import { desktopToolFactories } from './tools/desktop/tools.js';
import { Provider } from './utils/provider.js';

vi.unmock('@modelcontextprotocol/sdk/server/mcp.js');
vi.mock('./features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: vi.fn(() => false) })),
}));

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

describe('desktop tools/list alwaysLoad pins', () => {
  const ALWAYS_LOAD = { 'anthropic/alwaysLoad': true };
  const pinnedNames: ReadonlySet<string> = ALWAYS_LOAD_TOOL_NAMES;

  beforeEach(() => {
    vi.stubEnv('TOOL_PROFILE', '');
    // No discovery files, so the API-version gate cannot hide a pinned tool on a dev machine.
    vi.stubEnv('TABLEAU_EXTERNAL_API_DISCOVERY_DIR', '/nonexistent/always-load-discovery');
    vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
  });

  const listToolsOverClient = async (mcpServer?: McpServer): Promise<Tool[]> => {
    const desktopServer = new DesktopMcpServer({ mcpServer });
    await desktopServer.registerTools();
    const client = new Client({ name: 'always-load-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await desktopServer.mcpServer.connect(serverTransport);
      await client.connect(clientTransport);
      return (await client.listTools()).tools;
    } finally {
      await client.close();
      await desktopServer.mcpServer.close();
    }
  };

  it('names only tools the default profile registers', async () => {
    const listedNames = new Set((await listToolsOverClient()).map((tool) => tool.name));

    expect([...pinnedNames].filter((name) => !listedNames.has(name))).toEqual([]);
  });

  it('pins exactly the always-load tools on the desktop-owned tools/list', async () => {
    const tools = await listToolsOverClient();

    for (const name of pinnedNames) {
      expect(tools.find((tool) => tool.name === name)?._meta).toEqual(ALWAYS_LOAD);
    }
    const unpinned = tools.find((tool) => tool.name === 'list-worksheets');
    expect(unpinned).toBeDefined();
    expect(unpinned).not.toHaveProperty('_meta');
    expect(tools.filter((tool) => '_meta' in tool).map((tool) => tool.name)).toEqual(
      tools.map((tool) => tool.name).filter((name) => pinnedNames.has(name)),
    );
  });

  it('pins the same tools on a shared McpServer (combined variant)', async () => {
    const config = getDesktopConfig();
    const instructions = buildDesktopInstructions({
      sessionPinned: config.desktopSessionId !== undefined,
      profile: config.toolProfile,
    });
    const sharedServer = new McpServer(
      { name: 'always-load-shared', version: '0.0.0' },
      { instructions },
    );
    const tools = await listToolsOverClient(sharedServer);

    for (const name of pinnedNames) {
      expect(tools.find((tool) => tool.name === name)?._meta).toEqual(ALWAYS_LOAD);
    }
    const unpinned = tools.find((tool) => tool.name === 'list-worksheets');
    expect(unpinned).toBeDefined();
    expect(unpinned!._meta).toBeUndefined();
    expect(
      tools
        .filter((tool) => tool._meta !== undefined)
        .map((tool) => tool.name)
        .sort(),
    ).toEqual([...pinnedNames].sort());
  });

  it('keeps the model-facing pinned tools/list slice under 6,000 chars', async () => {
    const tools = await listToolsOverClient();
    const pinned = tools.filter((tool) => pinnedNames.has(tool.name)).map(getModelFacingToolEntry);

    expect(pinned).toHaveLength(pinnedNames.size);
    expect(JSON.stringify(pinned).length).toBeLessThan(6_000);
  });
});
