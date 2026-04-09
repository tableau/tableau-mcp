import { Ok } from 'ts-results-es';

import { testProductVersion } from '../../../src/testShared.js';
import { mockDatasources } from '../../../src/tools/listDatasources/mockDatasources.js';

vi.mock('../../../src/sdks/tableau/restApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  RestApi: vi.fn().mockImplementation(() => ({
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    setCredentials: vi.fn().mockResolvedValue(undefined),
    authenticatedServerMethods: {
      getCurrentServerSession: vi.fn().mockResolvedValue(
        Ok({
          site: {
            id: 'site_id',
            name: 'mcp-test',
            contentUrl: 'mcp-test',
          },
          user: {
            id: 'user_id',
            name: 'test-user',
          },
        }),
      ),
    },
    datasourcesMethods: {
      listDatasources: vi.fn().mockResolvedValue(mockDatasources),
    },
    serverMethods: {
      getServerInfo: vi.fn().mockResolvedValue({
        productVersion: testProductVersion,
      }),
    },
  })),
}));
