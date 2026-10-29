import { AxiosRequestConfig } from '../../../utils/axios.js';
import { RouteSafetyError } from '../../routeSafety/core.js';
import fixtures from '../fixtures/collections.json';
import CollectionPermissionsMethods from './collectionPermissionsMethods.js';

const collectionId = fixtures.create.luid;
const siteId = fixtures.create.siteId;
const ownerId = fixtures.create.userId;
const sentinel = 'PRIVATE_PERMISSION_SENTINEL';
function setup(response: unknown, headers: Record<string, string> = {}) {
  const requests: Array<{ url?: string; method?: string; auth: unknown }> = [];
  const config: AxiosRequestConfig = {
    adapter: async (config) => {
      requests.push({
        url: config.url,
        method: config.method,
        auth: config.headers.get('X-Tableau-Auth'),
      });
      return { data: response, status: 200, statusText: 'OK', headers, config };
    },
  };
  const methods = new CollectionPermissionsMethods(
    'https://tableau.test/api/3.29',
    {
      type: 'X-Tableau-Auth',
      token: 'synthetic-token',
      site: { id: siteId },
      user: { id: ownerId },
    },
    config,
  );
  return { methods, requests };
}

describe('Collection owner permissions', () => {
  it('uses a guarded site-scoped GET and returns only the two LUIDs', async () => {
    const { methods, requests } = setup({
      permissions: {
        collection: { id: collectionId, name: sentinel, owner: { id: ownerId, name: sentinel } },
        granteeCapabilities: [{ private: sentinel }],
      },
    });
    expect(await methods.queryCollectionOwner({ siteId, collectionId })).toEqual({
      collectionId,
      ownerId,
    });
    expect(requests).toEqual([
      {
        url: `/sites/${siteId}/collections/${collectionId}/permissions`,
        method: 'get',
        auth: 'synthetic-token',
      },
    ]);
  });

  it.each(['siteId', 'collectionId'] as const)(
    'refuses an unsafe %s before dispatch',
    async (field) => {
      const { methods, requests } = setup({});
      await expect(
        methods.queryCollectionOwner({ siteId, collectionId, [field]: '../unsafe' }),
      ).rejects.toBeInstanceOf(RouteSafetyError);
      expect(requests).toEqual([]);
    },
  );

  it.each([
    {},
    { permissions: {} },
    { permissions: { collection: { id: collectionId, owner: { id: '123' } } } },
    { permissions: { collection: { id: collectionId, owner: { id: { private: sentinel } } } } },
  ])('withholds malformed permission responses %j', async (response) => {
    const headerCases: Record<string, string>[] = [{}, { 'content-type': 'application/json' }];
    for (const headers of headerCases) {
      const { methods } = setup(response, headers);
      const error = await methods
        .queryCollectionOwner({ siteId, collectionId })
        .catch((error) => error);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toBe('Error: Collection owner permissions could not be verified.');
      expect(String(error)).not.toContain(sentinel);
      expect(error).not.toHaveProperty('cause');
    }
  });
});
