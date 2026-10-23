import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

import { buildWebInstructions, LOAD_WEB_TOOLS_TOOL_NAME, WebMcpServer } from './server.web.js';
import { stubDefaultEnvVars } from './testShared.js';
import { webToolGroups } from './tools/web/toolName.js';

vi.unmock('@modelcontextprotocol/sdk/server/mcp.js');
const mocks = vi.hoisted(() => ({
  enabledFeatures: new Set<string>(),
  siteRole: vi.fn(),
}));

vi.mock('./features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({
    isFeatureEnabled: vi.fn((name: string) => mocks.enabledFeatures.has(name)),
  })),
}));

vi.mock('./tools/web/adminGate.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tools/web/adminGate.js')>()),
  getCurrentUserSiteRole: mocks.siteRole,
}));

describe('combined-lean against the real MCP SDK server', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    vi.stubEnv('TOOL_PROFILE', 'combined-lean');
    mocks.enabledFeatures.clear();
    mocks.siteRole.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lists only the loader, then the pulse tools after load-web-tools, with list_changed', async () => {
    const mcpServer = new McpServer(
      { name: 'combined-lean-sdk', version: '0.0.0' },
      { capabilities: { tools: { listChanged: true } }, instructions: buildWebInstructions() },
    );
    const server = new WebMcpServer({ mcpServer });
    await server.registerTools();

    const client = new Client({ name: 'combined-lean-sdk-client', version: '0.0.0' });
    const listChanged = vi.fn();
    client.setNotificationHandler(ToolListChangedNotificationSchema, listChanged);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await mcpServer.connect(serverTransport);
      await client.connect(clientTransport);

      const before = (await client.listTools()).tools.map((tool) => tool.name);
      expect(before).toEqual([LOAD_WEB_TOOLS_TOOL_NAME]);

      const result = await client.callTool({
        name: LOAD_WEB_TOOLS_TOOL_NAME,
        arguments: { group: 'pulse' },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      expect(JSON.parse(content[0].text)).toEqual({
        status: 'loaded',
        toolNames: [...webToolGroups.pulse],
      });

      await vi.waitFor(() => expect(listChanged).toHaveBeenCalled());
      const after = (await client.listTools()).tools.map((tool) => tool.name);
      expect(after.sort()).toEqual([LOAD_WEB_TOOLS_TOOL_NAME, ...webToolGroups.pulse].sort());
    } finally {
      await client.close();
      await mcpServer.close();
    }
  });

  it('reports a partial load with a retry warning over the real SDK, then completes on retry', async () => {
    vi.stubEnv('ADMIN_TOOLS_ENABLED', 'true');
    mocks.enabledFeatures.add('enforce-role-requirements');
    mocks.enabledFeatures.add('admin-tools');
    mocks.siteRole.mockResolvedValue(undefined);
    const mcpServer = new McpServer(
      { name: 'combined-lean-sdk', version: '0.0.0' },
      { capabilities: { tools: { listChanged: true } }, instructions: buildWebInstructions() },
    );
    await new WebMcpServer({ mcpServer }).registerTools();
    const client = new Client({ name: 'combined-lean-sdk-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const load = async (group: string): Promise<Record<string, unknown>> => {
      const result = await client.callTool({
        name: LOAD_WEB_TOOLS_TOOL_NAME,
        arguments: { group },
      });
      return JSON.parse((result.content as Array<{ text: string }>)[0].text);
    };

    try {
      await mcpServer.connect(serverTransport);
      await client.connect(clientTransport);

      const first = await load('tasks');
      expect(first.status).toBe('partial');
      expect(first.warnings).toEqual([expect.stringContaining('Call load-web-tools again')]);
      expect(first.toolNames).not.toContain('list-extract-refresh-tasks');

      mocks.siteRole.mockResolvedValue('SiteAdministratorCreator');
      const second = await load('tasks');
      expect(second.status).toBe('loaded');
      expect(second.warnings).toBeUndefined();
      expect(second.toolNames).toContain('list-extract-refresh-tasks');
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain(
        'list-extract-refresh-tasks',
      );
    } finally {
      await client.close();
      await mcpServer.close();
    }
  });
});
