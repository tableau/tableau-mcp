import { exportedForTesting as serverExportedForTesting } from './server.js';
import { getCodeModeExecuteTool } from './tools/codeMode/execute.js';
import { getCodeModeSearchTool } from './tools/codeMode/search.js';
import { getQueryDatasourceTool } from './tools/queryDatasource/queryDatasource.js';
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

    const tools = [
      getCodeModeSearchTool(server),
      getCodeModeExecuteTool(server),
      getQueryDatasourceTool(server),
    ];
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

  it('should ignore includeTools filter', async () => {
    process.env.INCLUDE_TOOLS = 'query-datasource';
    const server = getServer();
    await server.registerTools();

    expect(server.registerTool).toHaveBeenCalledTimes(3);
  });

  it('should ignore excludeTools filter', async () => {
    process.env.EXCLUDE_TOOLS = 'query-datasource';
    const server = getServer();
    await server.registerTools();

    expect(server.registerTool).toHaveBeenCalledTimes(3);
  });

  it('should register request handlers', async () => {
    const server = getServer();
    server.server.setRequestHandler = vi.fn();
    server.registerRequestHandlers();

    expect(server.server.setRequestHandler).toHaveBeenCalled();
  });
});

function getServer(): InstanceType<typeof Server> {
  const server = new Server();
  server.registerTool = vi.fn();
  return server;
}
