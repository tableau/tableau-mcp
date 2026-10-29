import { AxiosRequestConfig } from '../../../utils/axios.js';
import { RouteSafetyError } from '../../routeSafety/core.js';
import fixtures from '../fixtures/collections.json';
import CollectionsMethods from './collectionsMethods.js';

const id = fixtures.create.luid;
const item = {
  contentLuid: '22222222-2222-4222-8222-222222222222',
  contentType: 'workbook',
  contentName: 'Sales',
};
type Request = {
  url?: string;
  baseURL?: string;
  method?: string;
  queries: unknown;
  body: unknown;
  auth: unknown;
  accept: unknown;
};

function setup(
  response: Record<string, unknown> = {},
  responseHeaders: Record<string, string> = {},
): {
  methods: CollectionsMethods;
  requests: Request[];
} {
  const requests: Request[] = [];
  const axiosConfig: AxiosRequestConfig = {
    adapter: async (config) => {
      requests.push({
        url: config.url,
        baseURL: config.baseURL,
        method: config.method,
        queries: config.params,
        body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
        auth: config.headers.get('X-Tableau-Auth'),
        accept: config.headers.get('Accept'),
      });
      return { data: response, status: 200, statusText: 'OK', headers: responseHeaders, config };
    },
  };
  const methods = new CollectionsMethods(
    'https://tableau.test/api/-',
    {
      type: 'X-Tableau-Auth',
      token: 'synthetic-test-token',
      site: { id: fixtures.create.siteId },
      user: { id: fixtures.create.userId },
    },
    axiosConfig,
  );
  return { methods, requests };
}

describe('CollectionsMethods guarded transport', () => {
  it('uses unversioned collections and exact literal TAG query keys', async () => {
    const { methods, requests } = setup(fixtures.page);
    expect(
      await methods.listCollections({
        pageNumber: 2,
        pageSize: 10,
        filter: 'favorite:eq:true',
        sort: 'name:desc',
      }),
    ).toEqual(fixtures.page);
    expect(requests[0]).toMatchObject({
      url: '/collections',
      baseURL: 'https://tableau.test/api/-',
      method: 'get',
      queries: {
        'page number': 2,
        'page size': 10,
        filter: 'favorite:eq:true',
        'sort order': 'name:desc',
      },
      auth: 'synthetic-test-token',
      accept: 'application/json',
    });
    expect(requests).toHaveLength(1);
  });
  it('sends a direct creation body without visibility or wrappers', async () => {
    const { methods, requests } = setup(fixtures.create);
    expect(
      await methods.createCollection({ name: 'Quarterly review', description: 'Details' }),
    ).toEqual(fixtures.create);
    expect(requests[0]).toMatchObject({
      method: 'post',
      url: '/collections',
      body: { name: 'Quarterly review', description: 'Details' },
    });
  });
  it('lists item metadata with numeric identities', async () => {
    const { methods, requests } = setup(fixtures.itemsPage);
    expect(
      await methods.listCollectionItems({ collectionId: id, pageNumber: 1, pageSize: 100 }),
    ).toEqual(fixtures.itemsPage);
    expect(requests[0].url).toBe(`/collections/${id}/items`);
  });
  it('retrieves owner metadata from the documented details endpoint', async () => {
    const { methods, requests } = setup({ collection: fixtures.create });
    expect(await methods.getCollection(id)).toEqual({ collection: fixtures.create });
    expect(requests[0].url).toBe(`/collections/${id}`);
  });
  it.each(['add', 'remove'] as const)(
    'uses POST batch%s and preserves partial errors',
    async (action) => {
      const { methods, requests } = setup(fixtures.partial);
      const response =
        action === 'add'
          ? await methods.addCollectionItems({ collectionId: id, items: [item] })
          : await methods.removeCollectionItems({ collectionId: id, items: [item] });
      expect(response).toEqual(fixtures.partial);
      expect(requests[0]).toMatchObject({
        method: 'post',
        url: `/collections/${id}/items/${action === 'add' ? 'batchCreate' : 'batchDelete'}`,
        body: { items: [item] },
      });
      expect(requests.some((request) => request.method === 'delete')).toBe(false);
    },
  );
  it.each(['../other', '%2e%2e', `${id}/items`, `https://evil.example/${id}`])(
    'rejects unsafe collection path %s before adapter',
    async (collectionId) => {
      const { methods, requests } = setup();
      await expect(methods.listCollectionItems({ collectionId })).rejects.toBeInstanceOf(
        RouteSafetyError,
      );
      await expect(
        methods.addCollectionItems({ collectionId, items: [item] }),
      ).rejects.toBeInstanceOf(RouteSafetyError);
      await expect(
        methods.removeCollectionItems({ collectionId, items: [item] }),
      ).rejects.toBeInstanceOf(RouteSafetyError);
      expect(requests).toHaveLength(0);
    },
  );
  it('rejects malformed body identity before adapter', async () => {
    const { methods, requests } = setup();
    await expect(
      methods.addCollectionItems({ collectionId: id, items: [{ ...item, contentLuid: '42' }] }),
    ).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });
  it('rejects undocumented filter fields before adapter', async () => {
    const { methods, requests } = setup();
    await expect(methods.listCollections({ filter: 'name:eq:Sales' })).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });
});

describe('Collections response validation privacy', () => {
  const sentinel = 'PRIVATE_SCHEMA_RESPONSE_SENTINEL';
  it.each<Record<string, string>>([
    {},
    { 'content-type': 'application/json' },
    { 'content-type': 'text/plain' },
  ])('sanitizes malformed pages regardless of Content-Type %s', async (headers) => {
    const { methods } = setup({ items: sentinel }, headers);
    const error = await methods.listCollections().catch((error: unknown) => error);
    expect(error).toMatchObject({ type: 'collections-response-unverified', statusCode: 502 });
    expect(String(error)).not.toContain(sentinel);
    expect(error).not.toHaveProperty('cause');
    expect(error).not.toHaveProperty('data');
  });
  it('withholds malformed nonowned collection details', async () => {
    const { methods } = setup(
      { collection: { name: { private: sentinel } } },
      { 'content-type': 'application/json' },
    );
    const error = await methods.getCollection(id).catch((error: unknown) => error);
    expect(String(error)).not.toContain(sentinel);
    expect(error).toMatchObject({ type: 'collections-response-unverified' });
  });
  it('withholds malformed item metadata', async () => {
    const { methods } = setup({ items: [{ content: { id: sentinel } }] });
    const error = await methods
      .listCollectionItems({ collectionId: id })
      .catch((error: unknown) => error);
    expect(String(error)).not.toContain(sentinel);
    expect(error).toMatchObject({ type: 'collections-response-unverified' });
  });
  it('discloses possible creation after malformed write response without raw details', async () => {
    const { methods, requests } = setup(
      { name: { private: sentinel } },
      { 'content-type': 'application/json' },
    );
    const error = await methods
      .createCollection({ name: 'Review' })
      .catch((error: unknown) => error);
    expect(String(error)).toContain('creation may have occurred');
    expect(String(error)).toContain('No automatic retry');
    expect(String(error)).not.toContain(sentinel);
    expect(requests).toHaveLength(1);
  });
  it.each(['add', 'remove'] as const)(
    'discloses possible %s membership after malformed write response',
    async (action) => {
      const { methods, requests } = setup(
        { response: sentinel },
        { 'content-type': 'application/json' },
      );
      const result =
        action === 'add'
          ? methods.addCollectionItems({ collectionId: id, items: [item] })
          : methods.removeCollectionItems({ collectionId: id, items: [item] });
      const error = await result.catch((error: unknown) => error);
      expect(String(error)).toContain('membership changes may have occurred');
      expect(String(error)).not.toContain(sentinel);
      expect(error).not.toHaveProperty('cause');
      expect(requests).toHaveLength(1);
    },
  );
});
