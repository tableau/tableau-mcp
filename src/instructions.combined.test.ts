import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { getDesktopConfig } from './config.desktop.js';
import { buildCombinedInstructions } from './instructions.combined.js';
import { DesktopMcpServer } from './server.desktop.js';
import { WebMcpServer } from './server.web.js';
import { stubDefaultEnvVars } from './testShared.js';

vi.unmock('@modelcontextprotocol/sdk/server/mcp.js');

const mocks = vi.hoisted(() => ({
  siteRole: vi.fn(),
}));

vi.mock('./features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({
    isFeatureEnabled: vi.fn((name: string) => name === 'enforce-role-requirements'),
  })),
}));

vi.mock('./tools/web/adminGate.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tools/web/adminGate.js')>()),
  getCurrentUserSiteRole: mocks.siteRole,
}));

describe('combined initialize instruction visibility', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    vi.stubEnv('TRANSPORT', 'stdio');
    vi.stubEnv('TOOL_PROFILE', 'full');
    vi.stubEnv('ENABLE_MCP_SITE_SETTINGS', 'false');
    vi.stubEnv('ADMIN_TOOLS_ENABLED', 'true');
    mocks.siteRole.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([false, true])(
    'fits the raised limit with admin guidance and a registration warning, sessionPinned=%s',
    async (sessionPinned) => {
      vi.stubEnv('TABLEAU_DESKTOP_SESSION_ID', sessionPinned ? '4242' : undefined);
      const config = getDesktopConfig();
      const baseInstructions = buildCombinedInstructions({
        sessionPinned: config.desktopSessionId !== undefined,
        profile: config.toolProfile,
      });
      const mcpServer = new McpServer(
        { name: 'combined-instructions-test', version: '0.0.0' },
        { capabilities: { tools: {} }, instructions: baseInstructions },
      );
      const client = new Client({ name: 'combined-instructions-client', version: '0.0.0' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

      try {
        await new WebMcpServer({ mcpServer }).registerTools();
        const desktopServer = new DesktopMcpServer({ mcpServer });
        await desktopServer.registerTools();
        await desktopServer.registerResources();
        await mcpServer.connect(serverTransport);
        await client.connect(clientTransport);

        const instructions = client.getInstructions() ?? '';
        expect(instructions).toContain('site-administration capabilities');
        expect(instructions).toContain('site role could not be determined');
        expect(instructions).toContain('Disconnect and reconnect to retry');
        expect(instructions.startsWith(baseInstructions)).toBe(true);
        expect(instructions.length).toBeLessThanOrEqual(16_384);
      } finally {
        await client.close();
        await mcpServer.close();
      }
    },
  );
});
