import { ServiceUnavailableError } from './errors/mcpToolError.js';
import { serverName, WebMcpServer } from './server.web.js';
import { stubDefaultEnvVars, testProductVersion } from './testShared.js';
import { exportedForTesting } from './tools/web/datasources/listDatasources.js';
import { getQueryDatasourceTool } from './tools/web/queryDatasource/queryDatasource.js';
import { WebTool } from './tools/web/tool.js';
import { TableauWebToolCallback } from './tools/web/toolContext.js';
import { getMockRequestHandlerExtra } from './tools/web/toolContext.mock.js';
import { webToolNames } from './tools/web/toolName.js';
import { webToolFactories } from './tools/web/tools.js';
import invariant from './utils/invariant.js';
import { Provider } from './utils/provider.js';

const mocks = vi.hoisted(() => ({
  mockRegisterAppTool: vi.fn(),
  mockRegisterAppResource: vi.fn(),
  mockFeatureGate: {
    isFeatureEnabled: vi.fn(() => false),
  },
  mockReadFile: vi.fn(),
}));

vi.mock('@modelcontextprotocol/ext-apps/server', () => ({
  registerAppTool: mocks.mockRegisterAppTool,
  registerAppResource: mocks.mockRegisterAppResource,
  RESOURCE_MIME_TYPE: 'text/html',
}));

vi.mock('./features/featureGate.js', () => ({
  getFeatureGate: vi.fn(() => mocks.mockFeatureGate),
}));

vi.mock('fs/promises', () => ({
  readFile: (...args: any[]) => mocks.mockReadFile(...args),
}));

describe('server', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mocks.mockRegisterAppTool.mockClear();
    mocks.mockRegisterAppResource.mockClear();
    mocks.mockFeatureGate.isFeatureEnabled.mockReturnValue(false);
    mocks.mockReadFile.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Helper functions
  function getServer(): WebMcpServer {
    const server = new WebMcpServer();
    server.mcpServer.registerTool = vi.fn();
    return server;
  }

  function createMockAppTool(): WebTool<any> {
    return {
      name: 'get-workbook',
      server: {} as any,
      title: 'Test App Tool',
      description: 'Test App Tool',
      paramsSchema: {},
      annotations: { title: 'Test App Tool' },
      callback: vi.fn(),
      disabled: false,
      requiredApiScopes: [],
      logAndExecute: vi.fn(),
      notifyInvocation: vi.fn(),
      app: {
        name: 'test-app',
        resourceUri: 'tableau://app/test',
        htmlPath: '<html><body>Test App UI</body></html>',
      },
    };
  }

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

  it('should use the web variant server name', () => {
    expect(new WebMcpServer().name).toBe(serverName);
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

  it('should not throw and not register any tools when all are excluded', async () => {
    const sortedToolNames = [...webToolNames].sort((a, b) => a.localeCompare(b)).join(', ');
    vi.stubEnv('EXCLUDE_TOOLS', sortedToolNames);
    const server = getServer();

    await expect(server.registerTools()).resolves.toBeUndefined();
    expect(server.mcpServer.registerTool).not.toHaveBeenCalled();
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

  it('should register app tools when tool has app property', async () => {
    // Set custom CSP domains via environment
    vi.stubEnv('CSP_ALLOWED_DOMAINS', 'https://*.custom.com,https://other.com');

    mocks.mockFeatureGate.isFeatureEnabled.mockReturnValue(true);

    const server = getServer();
    const mockAppTool = createMockAppTool();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([mockAppTool]);

    await server.registerTools();

    expect(mocks.mockRegisterAppTool).toHaveBeenCalledWith(
      server.mcpServer,
      'get-workbook',
      {
        title: 'Test App Tool',
        description: 'Test App Tool',
        inputSchema: {},
        annotations: { title: 'Test App Tool' },
        _meta: {
          ui: {
            resourceUri: 'tableau://app/test',
          },
        },
      },
      expect.any(Function),
    );

    // Assert registerAppResource was called with correct options (no _meta in options)
    expect(mocks.mockRegisterAppResource).toHaveBeenCalledWith(
      server.mcpServer,
      'get-workbook',
      'tableau://app/test',
      {
        mimeType: expect.any(String),
      },
      expect.any(Function),
    );

    // Invoke the read callback and assert _meta is on the returned content
    const registerAppResourceCall = mocks.mockRegisterAppResource.mock.calls[0];
    const readCallback = registerAppResourceCall[4]; // 5th arg (0-indexed)

    // Mock readFile to return test HTML content
    mocks.mockReadFile.mockResolvedValueOnce('<html><body>Test App UI</body></html>');

    const result = await readCallback();

    expect(result.contents[0]._meta).toEqual({
      ui: {
        csp: {
          connectDomains: expect.arrayContaining([
            'https://*.online.tableau.com',
            'https://*.tableau.com',
            'https://my-tableau-server.com',
            'https://*.custom.com',
            'https://other.com',
          ]),
          resourceDomains: expect.arrayContaining([
            'https://*.online.tableau.com',
            'https://*.tableau.com',
            'https://my-tableau-server.com',
            'https://*.custom.com',
            'https://other.com',
          ]),
          frameDomains: expect.arrayContaining([
            'https://*.online.tableau.com',
            'https://*.tableau.com',
            'https://my-tableau-server.com',
            'https://*.custom.com',
            'https://other.com',
          ]),
        },
      },
      'openai/widgetCSP': {
        connect_domains: expect.arrayContaining([
          'https://*.online.tableau.com',
          'https://*.tableau.com',
          'https://my-tableau-server.com',
          'https://*.custom.com',
          'https://other.com',
        ]),
        resource_domains: expect.arrayContaining([
          'https://*.online.tableau.com',
          'https://*.tableau.com',
          'https://my-tableau-server.com',
          'https://*.custom.com',
          'https://other.com',
        ]),
        frame_domains: expect.arrayContaining([
          'https://*.online.tableau.com',
          'https://*.tableau.com',
          'https://my-tableau-server.com',
          'https://*.custom.com',
          'https://other.com',
        ]),
      },
    });
  });

  it('should register as standard tool when mcp-apps feature flag is disabled', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockReturnValue(false);

    const server = getServer();
    const mockAppTool = createMockAppTool();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([mockAppTool]);

    await server.registerTools();

    // Should register as standard tool, not app tool
    expect(server.mcpServer.registerTool).toHaveBeenCalledWith(
      'get-workbook',
      {
        title: 'Test App Tool',
        description: 'Test App Tool',
        inputSchema: {},
        annotations: { title: 'Test App Tool' },
      },
      expect.any(Function),
    );

    // Should NOT register as app tool
    expect(mocks.mockRegisterAppTool).not.toHaveBeenCalled();
    expect(mocks.mockRegisterAppResource).not.toHaveBeenCalled();
  });
});
