import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { testProductVersion } from '../../../src/testShared.js';
import { getEnv } from '../../testEnv.js';

const { SITE_NAME } = getEnv(
  z.object({
    SITE_NAME: z.string(),
  }),
);

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
            name: SITE_NAME,
            contentUrl: SITE_NAME,
          },
          user: {
            id: 'user_id',
            name: 'test-user',
          },
        }),
      ),
    },
    serverMethods: {
      getServerInfo: vi.fn().mockResolvedValue({
        productVersion: testProductVersion,
      }),
    },
  })),
}));
