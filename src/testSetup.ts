import { join } from 'path';
import { Ok } from 'ts-results-es';

import { stubDefaultEnvVars, testProductVersion } from './testShared.js';

stubDefaultEnvVars();

// DATA_ROOT is derived from getDirname() at runtime, which does not resolve to
// the source data dir under vitest. Point the desktop search tools at the
// committed corpus so they exercise the real file instead of a null corpus.
process.env.CORPUS_PATH ??= join(process.cwd(), 'src', 'desktop', 'data', 'corpus.json');

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
