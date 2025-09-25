import { ZodObject } from 'zod';

import { exportedForTesting as serverExportedForTesting } from './server.js';
import { getQueryDatasourceTool } from './tools/queryDatasource/queryDatasource.js';
import { toolNames } from './tools/toolName.js';
import { toolFactories } from './tools/tools.js';

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
    server.registerTools();

    const tools = toolFactories.map((tool) => tool(server));
    for (const tool of tools) {
      expect(server.tool).toHaveBeenCalledWith(
        tool.name,
        tool.description,
        expect.any(Object),
        expect.any(Object),
        expect.any(Function),
      );
    }
  });

  it('should register tools filtered by includeTools', async () => {
    process.env.INCLUDE_TOOLS = 'query-datasource';
    const server = getServer();
    server.registerTools();

    const tool = getQueryDatasourceTool(server);
    expect(server.tool).toHaveBeenCalledWith(
      tool.name,
      tool.description,
      expect.any(Object),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('should register tools filtered by excludeTools', async () => {
    process.env.EXCLUDE_TOOLS = 'query-datasource';
    const server = getServer();
    server.registerTools();

    const tools = toolFactories.map((tool) => tool(server));
    for (const tool of tools) {
      if (tool.name === 'query-datasource') {
        expect(server.tool).not.toHaveBeenCalledWith(
          tool.name,
          tool.description,
          expect.any(Object),
          expect.any(Object),
          expect.any(Function),
        );
      } else {
        expect(server.tool).toHaveBeenCalledWith(
          tool.name,
          tool.description,
          expect.any(Object),
          expect.any(Object),
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
      expect(() => server.registerTools()).toThrow(sentence);
    }
  });

  it('should register search-content tool when auth is pat', async () => {
    // Set up PAT auth environment variables
    process.env.AUTH = 'pat';
    process.env.SERVER = 'https://test-server.com';
    process.env.PAT_NAME = 'test-pat-name';
    process.env.PAT_VALUE = 'test-pat-value';

    const server = getServer();
    server.registerTools();

    const tools = toolFactories.map((tool) => tool(server));

    // Verify search-content tool IS registered
    const searchContentTool = tools.find((tool) => tool.name === 'search-content');
    expect(searchContentTool).toBeDefined();
    expect(server.tool).toHaveBeenCalledWith(
      'search-content',
      searchContentTool!.description,
      expect.any(Object),
      expect.any(Object),
      expect.any(Function),
    );

    // Verify all tools are registered (including search-content)
    for (const tool of tools) {
      expect(server.tool).toHaveBeenCalledWith(
        tool.name,
        tool.description,
        expect.any(Object),
        expect.any(Object),
        expect.any(Function),
      );
    }
  });

  it('should not register search-content tool when auth is direct-trust', async () => {
    // Set up direct-trust auth environment variables
    process.env.AUTH = 'direct-trust';
    process.env.SERVER = 'https://test-server.com';
    process.env.JWT_SUB_CLAIM = 'test-jwt-sub-claim';
    process.env.CONNECTED_APP_CLIENT_ID = 'test-client-id';
    process.env.CONNECTED_APP_SECRET_ID = 'test-secret-id';
    process.env.CONNECTED_APP_SECRET_VALUE = 'test-secret-value';

    const server = getServer();
    server.registerTools();

    const tools = toolFactories.map((tool) => tool(server));

    // Verify search-content tool is NOT registered
    const searchContentTool = tools.find((tool) => tool.name === 'search-content');
    expect(searchContentTool).toBeDefined();
    expect(server.tool).not.toHaveBeenCalledWith(
      'search-content',
      searchContentTool!.description,
      expect.any(Object),
      expect.any(Object),
      expect.any(Function),
    );

    // Verify other tools ARE still registered
    for (const tool of tools) {
      if (tool.name !== 'search-content') {
        expect(server.tool).toHaveBeenCalledWith(
          tool.name,
          tool.description,
          expect.any(Object),
          expect.any(Object),
          expect.any(Function),
        );
      }
    }
  });

  it('should register request handlers', async () => {
    const server = getServer();
    server.server.setRequestHandler = vi.fn();
    server.registerRequestHandlers();

    expect(server.server.setRequestHandler).toHaveBeenCalledWith(
      expect.any(ZodObject),
      expect.any(Function),
    );
  });
});

function getServer(): InstanceType<typeof Server> {
  const server = new Server();
  server.tool = vi.fn();
  return server;
}
