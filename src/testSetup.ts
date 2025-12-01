import { testProductVersion } from './testShared.js';

vi.stubEnv('SERVER', 'https://my-tableau-server.com');
vi.stubEnv('SITE_NAME', 'tc25');
vi.stubEnv('PAT_NAME', 'sponge');
vi.stubEnv('PAT_VALUE', 'bob');
vi.stubEnv('TABLEAU_MCP_TEST', 'true');

vi.mock('./server.js', async (importOriginal) => ({
  ...(await importOriginal()),
  Server: vi.fn().mockImplementation(() => ({
    name: 'test-server',
    server: {
      notification: vi.fn(),
    },
  })),
}));

vi.mock('./sdks/tableau/restApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  RestApi: vi.fn().mockImplementation(() => ({
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    serverMethods: {
      getServerInfo: vi.fn().mockResolvedValue({
        productVersion: testProductVersion,
      }),
    },
  })),
}));

vi.mock('./utils/featureEnabledCache.js', async (importOriginal) => ({
  ...(await importOriginal()),
  // Consider all features enabled for testing purposes
  isFeatureEnabled: vi.fn().mockResolvedValue(true),
}));
