import './networkGuard.js';
import '../../../src/testTelemetryGuard.js';

import { Ok } from 'ts-results-es';

import { closeLoopbackServer, startLoopbackServer } from '../../../src/testLoopbackRequest.js';
import { testProductVersion } from '../../../src/testShared.js';
import { mockDatasources } from '../../../src/tools/web/datasources/mockDatasources.js';

vi.mock('../../../src/sdks/tableau/restApi.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/sdks/tableau/restApi.js')>();
  const MockRestApi = Object.assign(
    vi.fn().mockImplementation(() => ({
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
    { versionIsAtLeast: vi.fn().mockReturnValue(true) },
  );
  return {
    ...original,
    RestApi: MockRestApi,
  };
});

// Admin tools need both ADMIN_TOOLS_ENABLED (set in testEnv.ts) and the admin-tools flag; force
// only that flag on so every other flag keeps its real value.
vi.mock('../../../src/features/init.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/features/init.js')>();
  return {
    ...original,
    getFeatureGate: () => {
      const featureGate = original.getFeatureGate();
      return {
        isFeatureEnabled: async (featureName: string) =>
          featureName === 'admin-tools' || featureGate.isFeatureEnabled(featureName),
      };
    },
  };
});

beforeEach(startLoopbackServer);
afterEach(closeLoopbackServer);
