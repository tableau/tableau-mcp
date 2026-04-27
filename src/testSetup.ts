import { stubDefaultEnvVars, testProductVersion } from './testShared.js';

stubDefaultEnvVars();

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', async (importOriginal) => {
  return {
    ...(await importOriginal()),
    McpServer: vi.fn().mockImplementation(() => ({
      server: {
        notification: vi.fn(),
        setRequestHandler: vi.fn(),
        getClientVersion: vi.fn(),
      },
      registerTool: vi.fn(),
      connect: vi.fn(),
      close: vi.fn(),
    })),
  };
});

vi.mock('./sdks/tableau/restApi.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./sdks/tableau/restApi.js')>();
  const MockRestApi = Object.assign(
    vi.fn().mockImplementation(() => ({
      signIn: vi.fn().mockResolvedValue(undefined),
      signOut: vi.fn().mockResolvedValue(undefined),
      setCredentials: vi.fn(),
      setBearerToken: vi.fn(),
      serverMethods: {
        getServerInfo: vi.fn().mockResolvedValue({
          productVersion: testProductVersion,
        }),
      },
    })),
    { versionIsAtLeast: vi.fn().mockReturnValue(true) },
  );
  return {
    ...original,
    RestApi: MockRestApi,
  };
});
