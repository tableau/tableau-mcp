import { Ok } from 'ts-results-es';

import { stubDefaultEnvVars, testProductVersion } from './testShared.js';

stubDefaultEnvVars();

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', async (importOriginal) => {
  return {
    ...(await importOriginal()),
    McpServer: vi.fn().mockImplementation(() => ({
      server: {
        // notification() is async on the real SDK and always returns a Promise —
        // match that here so tests exercising rejection/.catch() behavior don't
        // need per-test overrides just to get a thenable back.
        notification: vi.fn().mockResolvedValue(undefined),
        setRequestHandler: vi.fn(),
        getClientVersion: vi.fn().mockReturnValue({
          version: '1.0.0',
          name: 'test-client',
        }),
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
      authenticatedServerMethods: {
        getCurrentServerSession: vi.fn().mockResolvedValue(
          new Ok({
            site: { id: 'abc123', name: 'site-name', contentUrl: 'default-site' },
            user: { id: 'default-user-id', name: 'user@example.com' },
          }),
        ),
      },
    })),
    { versionIsAtLeast: vi.fn().mockReturnValue(true) },
  );
  return {
    ...original,
    RestApi: MockRestApi,
  };
});
