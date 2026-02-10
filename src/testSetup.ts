import { stubDefaultEnvVars, testProductVersion } from './testShared.js';

stubDefaultEnvVars();

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
