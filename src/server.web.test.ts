import { ServiceUnavailableError } from './errors/mcpToolError.js';
import { WebMcpServer } from './server.web.js';
import { stubDefaultEnvVars, testProductVersion } from './testShared.js';
import { exportedForTesting } from './tools/web/listDatasources/listDatasources.js';
import { getQueryDatasourceTool } from './tools/web/queryDatasource/queryDatasource.js';
import { TableauWebToolCallback } from './tools/web/toolContext.js';
import { getMockRequestHandlerExtra } from './tools/web/toolContext.mock.js';
import { webToolNames } from './tools/web/toolName.js';
import { webToolFactories } from './tools/web/tools.js';
import invariant from './utils/invariant.js';
import { Provider } from './utils/provider.js';

describe('server', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should register tools', async () => {
    const server = getServer();
    await server.registerTools();

    const allTools = webToolFactories.map((toolFactory) => toolFactory(server, testProductVersion));
    const disabledFlags = await Promise.all(allTools.map((tool) => Provider.from(tool.disabled)));
    const tools = allTools.filter((_, i) => !disabledFlags[i]);
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

  it('should not register disabled tools', async () => {
    const server = getServer();
    await server.registerTools();

    const allDisabledTools = webToolFactories.map((toolFactory) =>
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
    vi.stubEnv('INCLUDE_TOOLS', 'query-datasource');
    const server = getServer();
    await server.registerTools();

    const tool = getQueryDatasourceTool(server, testProductVersion);
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
  });

  it('should register tools filtered by excludeTools', async () => {
    vi.stubEnv('EXCLUDE_TOOLS', 'query-datasource');
    const server = getServer();
    await server.registerTools();

    const tools = webToolFactories.map((toolFactory) => toolFactory(server, testProductVersion));
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
            title: await Provider.from(tool.title),
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
    const sortedToolNames = [...webToolNames].sort((a, b) => a.localeCompare(b)).join(', ');
    vi.stubEnv('EXCLUDE_TOOLS', sortedToolNames);
    const server = getServer();

    const sentences = [
      'No tools to register',
      `Tools available = [${webToolNames.join(', ')}]`,
      `EXCLUDE_TOOLS = [${sortedToolNames}]`,
      'INCLUDE_TOOLS = []',
    ];

    for (const sentence of sentences) {
      await expect(server.registerTools).rejects.toThrow(sentence);
    }
  });

  it('should reject tool calls with service unavailable error when BREAK_GLASS_DISABLE_GLOBALLY is true', async () => {
    vi.stubEnv('BREAK_GLASS_DISABLE_GLOBALLY', 'true');

    const server = getServer();
    await server.registerTools();

    const listDatasourcesRegistration = vi
      .mocked(server.mcpServer.registerTool)
      .mock.calls.find((call) => call[0 /* tool name */] === 'list-datasources');

    invariant(listDatasourcesRegistration);
    const listDatasourcesCallback =
      listDatasourcesRegistration[2 /* callback */] as TableauWebToolCallback<
        Partial<typeof exportedForTesting.listDatasourcesParamsSchema>
      >;

    await expect(listDatasourcesCallback({}, getMockRequestHandlerExtra())).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ServiceUnavailableError &&
        error.type === 'service-unavailable' &&
        error.statusCode === 503 &&
        error.message ===
          'The Tableau MCP server is temporarily unavailable. Please try again later.',
    );
  });
});

function getServer(): WebMcpServer {
  const server = new WebMcpServer();
  server.mcpServer.registerTool = vi.fn();
  return server;
}
