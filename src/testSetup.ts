import { Ok } from 'ts-results-es';

import { stubDefaultEnvVars, testProductVersion } from './testShared.js';

stubDefaultEnvVars();

beforeEach(async () => {
  // Imported dynamically (not at top level) so this global setup file doesn't eagerly pull in
  // `./dataApps/init.js`'s dependency graph — which reaches `./config.js` and, through it, the
  // real, unmocked `./logging/fileLogger.js` — before each test file's own `vi.mock(...)` calls
  // register. A static top-level import here broke `src/logging/logger.test.ts`'s
  // `vi.mock('./fileLogger.js')` isolation.
  const { resetDataAppWorkspaceStore } = await import('./dataApps/init.js');
  resetDataAppWorkspaceStore();
});

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', async (importOriginal) => {
  return {
    ...(await importOriginal()),
    McpServer: vi.fn().mockImplementation(() => ({
      server: {
        notification: vi.fn(),
        setRequestHandler: vi.fn(),
        getClientVersion: vi.fn().mockReturnValue({
          version: '1.0.0',
          name: 'test-client',
        }),
        getCapabilities: vi.fn().mockReturnValue({
          logging: {},
          tools: {},
          prompts: {},
          resources: {},
        }),
      },
      registerTool: vi.fn(),
      registerResource: vi.fn(),
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
