import { exportedForTesting as serverExportedForTesting } from './server.js';
import { testProductVersion } from './testShared.js';
import { getQueryDatasourceTool } from './tools/queryDatasource/queryDatasource.js';
import { toolNames } from './tools/toolName.js';
import { toolFactories } from './tools/tools.js';
import { Provider } from './utils/provider.js';

const { Server } = serverExportedForTesting;

describe('server', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      INCLUDE_TOOLS: undefined,
      EXCLUDE_TOOLS: undefined,
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should register tools', async () => {
    const server = getServer();
    await server.registerTools();

    const allTools = toolFactories.map((toolFactory) => toolFactory(server, testProductVersion));
    const disabledFlags = await Promise.all(allTools.map((tool) => Provider.from(tool.disabled)));
    const tools = allTools.filter((_, i) => !disabledFlags[i]);
    for (const tool of tools) {
      expect(server.mcpServer.registerTool).toHaveBeenCalledWith(
        tool.name,
        {
          description: await Provider.from(tool.description),
          inputSchema: await Provider.from(tool.paramsSchema),
          annotations: await Provider.from(tool.annotations),
        },
        expect.any(Function),
      );
    }
  });

  it('should not register disabled tools', async () => {
    const server = getServer();
    await server.registerTools();

    const allDisabledTools = toolFactories.map((toolFactory) =>
      toolFactory(server, testProductVersion),
    );
    const disabledToolFlags = await Promise.all(
      allDisabledTools.map((tool) => Provider.from(tool.disabled)),
    );
    const disabledTools = allDisabledTools.filter((_, i) => disabledToolFlags[i]);
    for (const tool of disabledTools) {
      expect(server.mcpServer.registerTool).not.toHaveBeenCalledWith(
        tool.name,
        expect.anything(),
        expect.anything(),
      );
    }
  });

  it('should register tools filtered by includeTools', async () => {
    process.env.INCLUDE_TOOLS = 'query-datasource';
    const server = getServer();
    await server.registerTools();

    const tool = getQueryDatasourceTool(server, testProductVersion);
    expect(server.mcpServer.registerTool).toHaveBeenCalledWith(
      tool.name,
      {
        description: await Provider.from(tool.description),
        inputSchema: await Provider.from(tool.paramsSchema),
        annotations: await Provider.from(tool.annotations),
      },
      expect.any(Function),
    );
  });

  it('should register tools filtered by excludeTools', async () => {
    process.env.EXCLUDE_TOOLS = 'query-datasource';
    const server = getServer();
    await server.registerTools();

    const tools = toolFactories.map((toolFactory) => toolFactory(server, testProductVersion));
    const excludeDisabledFlags = await Promise.all(
      tools.map((tool) => Provider.from(tool.disabled)),
    );
    for (const [i, tool] of tools.entries()) {
      if (tool.name === 'query-datasource' || excludeDisabledFlags[i]) {
        expect(server.mcpServer.registerTool).not.toHaveBeenCalledWith(
          tool.name,
          expect.anything(),
          expect.anything(),
        );
      } else {
        expect(server.mcpServer.registerTool).toHaveBeenCalledWith(
          tool.name,
          {
            description: await Provider.from(tool.description),
            inputSchema: await Provider.from(tool.paramsSchema),
            annotations: await Provider.from(tool.annotations),
          },
          expect.any(Function),
        );
      }
    }
  });

  it('should throw error when no tools are registered', async () => {
    const sortedToolNames = [...toolNames].sort((a, b) => a.localeCompare(b)).join(', ');
    process.env.EXCLUDE_TOOLS = sortedToolNames;
    const server = getServer();

    const sentences = [
      'No tools to register',
      `Tools available = [${toolNames.join(', ')}]`,
      `EXCLUDE_TOOLS = [${sortedToolNames}]`,
      'INCLUDE_TOOLS = []',
    ];

    for (const sentence of sentences) {
      await expect(server.registerTools).rejects.toThrow(sentence);
    }
  });

  it('should register request handlers', async () => {
    const server = getServer();
    server.mcpServer.server.setRequestHandler = vi.fn();
    server.registerRequestHandlers();

    expect(server.mcpServer.server.setRequestHandler).toHaveBeenCalled();
  });
});

function getServer(): InstanceType<typeof Server> {
  const server = new Server();
  server.mcpServer.registerTool = vi.fn();
  return server;
}
