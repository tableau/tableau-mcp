import './testTelemetryGuard.js';

import { Ok } from 'ts-results-es';

import { stubDefaultEnvVars, testProductVersion } from './testShared.js';

stubDefaultEnvVars();

beforeEach(async () => {
  stubDefaultEnvVars();
  // Production initializes the key-value store at startup; give every test a fresh one. Suites that
  // mock getConfig without a keyValueStore (or the storage module itself) skip this.
  try {
    const { initializeKeyValueStore, resetKeyValueStore } = await import('./storage/init.js');
    resetKeyValueStore();
    initializeKeyValueStore();
  } catch {
    // This suite mocks the storage module or getConfig, so it manages the store itself.
  }
});

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', async (importOriginal) => {
  return {
    ...(await importOriginal()),
    McpServer: vi.fn().mockImplementation(() => ({
      server: {
        notification: vi.fn(),
        setRequestHandler: vi.fn(),
        registerCapabilities: vi.fn(),
        getClientVersion: vi.fn().mockReturnValue({
          version: '1.0.0',
          name: 'test-client',
        }),
        getClientCapabilities: vi.fn().mockReturnValue(undefined),
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
