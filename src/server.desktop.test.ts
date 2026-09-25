import { DesktopMcpServer } from './server.desktop.js';
import { desktopToolFactories } from './tools/desktop/tools.js';
import { Provider } from './utils/provider.js';

const mocks = vi.hoisted(() => ({
  mockFeatureGate: {
    isFeatureEnabled: vi.fn((_featureName: string) => false),
  },
}));

vi.mock('./features/init.js', () => ({
  getFeatureGate: vi.fn(() => mocks.mockFeatureGate),
}));

describe('DesktopMcpServer', () => {
  beforeEach(() => {
    mocks.mockFeatureGate.isFeatureEnabled.mockReturnValue(false);
  });

  it('should register tools', async () => {
    const server = getServer();
    await server.registerTools();

    const allTools = desktopToolFactories.map((toolFactory) => toolFactory(server));
    const disabledFlags = await Promise.all(allTools.map((tool) => Provider.from(tool.disabled)));
    const tools = allTools.filter((_, i) => !disabledFlags[i]);
    expect(server.mcpServer.registerTool).toHaveBeenCalledTimes(tools.length);
    for (const tool of tools) {
      expect(server.mcpServer.registerTool).toHaveBeenCalledWith(
        tool.name,
        {
          title: await Provider.from(tool.title),
          description: await Provider.from(tool.description),
          inputSchema: await Provider.from(tool.paramsSchema),
          annotations: await Provider.from(tool.annotations),
        },
        expect.any(Function),
      );
    }
  });

  it('advertises the skills extension capability when skills-over-mcp is enabled', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(
      (name: string) => name === 'skills-over-mcp',
    );
    const server = getServer();
    await server.registerTools();

    expect(server.mcpServer.server.registerCapabilities).toHaveBeenCalledWith({
      extensions: { 'io.modelcontextprotocol/skills': { directoryRead: false } },
    });
  });

  it('does not advertise the skills extension capability when skills-over-mcp is disabled', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(() => false);
    const server = getServer();
    await server.registerTools();

    expect(server.mcpServer.server.registerCapabilities).not.toHaveBeenCalled();
  });
});

function getServer(): DesktopMcpServer {
  const server = new DesktopMcpServer();
  server.mcpServer.registerTool = vi.fn();
  return server;
}
