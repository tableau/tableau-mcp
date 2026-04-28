import { isRequestOverridableVariable } from './overridableConfig';
import { exportedForTesting as serverExportedForTesting } from './server.js';
import { testProductVersion } from './testShared.js';
import { getQueryDatasourceTool } from './tools/queryDatasource/queryDatasource.js';
import { toolNames } from './tools/toolName.js';
import { toolFactories } from './tools/tools.js';
import { Provider } from './utils/provider.js';

vi.mock('./overridableConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./overridableConfig')>();
  return {
    ...actual,
    isRequestOverridableVariable: vi.fn(actual.isRequestOverridableVariable),
  };
});

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
      expect(server.registerTool).toHaveBeenCalledWith(
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
      expect(server.registerTool).not.toHaveBeenCalledWith(
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
    expect(server.registerTool).toHaveBeenCalledWith(
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
        expect(server.registerTool).not.toHaveBeenCalledWith(
          tool.name,
          expect.anything(),
          expect.anything(),
        );
      } else {
        expect(server.registerTool).toHaveBeenCalledWith(
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
    server.server.setRequestHandler = vi.fn();
    server.registerRequestHandlers();

    expect(server.server.setRequestHandler).toHaveBeenCalled();
  });
});

describe('getRequestOverridesFromHeader', () => {
  beforeEach(() => {
    vi.mocked(isRequestOverridableVariable).mockReset();
  });

  it('should return empty object when header is undefined', () => {
    const server = new Server();
    expect(server.getRequestOverridesFromHeader(undefined)).toEqual({});
  });

  it('should return empty object when header is an empty string', () => {
    const server = new Server();
    expect(server.getRequestOverridesFromHeader('')).toEqual({});
  });

  it('should throw when header is an array', () => {
    const server = new Server();
    expect(() => server.getRequestOverridesFromHeader(['a', 'b'])).toThrow(
      "Unsupported format for 'x-tableau-mcp-config' header",
    );
  });

  it('should parse a single override', () => {
    vi.mocked(isRequestOverridableVariable).mockReturnValue(true);
    const server = new Server();

    expect(server.getRequestOverridesFromHeader('INCLUDE_PROJECT_IDS=abc')).toEqual({
      INCLUDE_PROJECT_IDS: 'abc',
    });
  });

  it('should parse multiple overrides separated by &', () => {
    vi.mocked(isRequestOverridableVariable).mockReturnValue(true);
    const server = new Server();

    expect(
      server.getRequestOverridesFromHeader('INCLUDE_PROJECT_IDS=abc&INCLUDE_TAGS=tag1'),
    ).toEqual({ INCLUDE_PROJECT_IDS: 'abc', INCLUDE_TAGS: 'tag1' });
  });

  it('should accept an empty string value for a valid key', () => {
    vi.mocked(isRequestOverridableVariable).mockReturnValue(true);
    const server = new Server();

    expect(server.getRequestOverridesFromHeader('INCLUDE_PROJECT_IDS=')).toEqual({
      INCLUDE_PROJECT_IDS: '',
    });
  });

  it('should throw when a key is not a request-overridable variable', () => {
    vi.mocked(isRequestOverridableVariable).mockReturnValue(false);
    const server = new Server();

    expect(() => server.getRequestOverridesFromHeader('INVALID_KEY=value')).toThrow(
      "'x-tableau-mcp-config' header is invalid",
    );
  });

  it('should throw when a valid key has no value', () => {
    vi.mocked(isRequestOverridableVariable).mockReturnValue(true);
    const server = new Server();

    expect(() => server.getRequestOverridesFromHeader('INCLUDE_PROJECT_IDS')).toThrow(
      "'x-tableau-mcp-config' header does not provide a value for 'INCLUDE_PROJECT_IDS'",
    );
  });

  it('should throw on the first invalid key in a multi-override header', () => {
    vi.mocked(isRequestOverridableVariable).mockImplementation(
      (key) => key === 'INCLUDE_PROJECT_IDS',
    );
    const server = new Server();

    expect(() =>
      server.getRequestOverridesFromHeader('INCLUDE_PROJECT_IDS=abc&BAD_KEY=val'),
    ).toThrow("'x-tableau-mcp-config' header is invalid");
  });
});

function getServer(): InstanceType<typeof Server> {
  const server = new Server();
  server.registerTool = vi.fn();
  return server;
}
