import { MockInstance } from 'vitest';

import { getExchangeConfig } from '../config.exchange.js';
import { ExchangeDiscoveryService } from './ExchangeDiscoveryService.js';
import { GalleryApiClient, GalleryApiClientError } from './gallery/GalleryApiClient.js';
import { galleryProductSchema } from './gallery/galleryApiSchemas.js';

const config = getExchangeConfig({
  GALLERY_API_BASE_URL: 'https://gallery.example/',
  EXCHANGE_WEB_BASE_URL: 'https://exchange.example/',
  PRODUCT_PAGE_SIZE: '2',
});
const products = [1, 2].map((id) =>
  galleryProductSchema.parse({
    id,
    product_type: 'skill',
    name: `Workbook Skill ${id}`,
    publisher_name: 'Vendor',
    typed_tags: [
      {
        id: 10,
        name: 'Build and Design',
        canonicalName: 'Build and Design',
        type: 'category',
        applicableProductType: 'skill',
      },
    ],
    community_contribution: false,
  }),
);
function setup(): {
  client: GalleryApiClient;
  list: MockInstance<GalleryApiClient['listProducts']>;
  detail: MockInstance<GalleryApiClient['getProduct']>;
  service: ExchangeDiscoveryService;
} {
  const client = new GalleryApiClient({ apiBaseUrl: config.apiBaseUrl, timeoutMs: 20 });
  const list = vi
    .spyOn(client, 'listProducts')
    .mockImplementation(async ({ type, page, community, perPage }) => ({
      products: type === 'skill' && page === 1 && !community ? products : [],
      page,
      per_page: perPage,
      total: null,
      next: null,
    }));
  const detail = vi
    .spyOn(client, 'getProduct')
    .mockImplementation(
      async ({ productId }) => products.find((product) => product.id === productId) ?? products[0],
    );
  vi.spyOn(client, 'listTags').mockResolvedValue([
    {
      id: 10,
      name: 'Build and Design',
      canonicalName: 'Build and Design',
      type: 'category',
      applicableProductType: 'skill',
    },
    {
      id: 11,
      name: 'Unused',
      canonicalName: 'Unused',
      type: 'category',
      applicableProductType: 'skill',
    },
  ]);
  return {
    client,
    list,
    detail,
    service: new ExchangeDiscoveryService({ client, options: config.options }),
  };
}
describe('ExchangeDiscoveryService', () => {
  it('gates guessed IDs by catalog membership and compares ordered IDs with unknowns', async () => {
    const { service, detail } = setup();
    const unknown = await service.getAsset({ productId: 99 });
    expect(unknown.isErr()).toBe(true);
    expect(detail).not.toHaveBeenCalled();
    const comparison = (await service.compare({ productIds: [2, 1] })).unwrap();
    expect(comparison.data.assets.map((asset) => asset.id)).toEqual([2, 1]);
    expect(
      comparison.data.dimensions.every(
        (dimension) => dimension.downloads === null && dimension.minimumTableauVersion === null,
      ),
    ).toBe(true);
    expect((await service.compare({ productIds: [1, 1] })).isErr()).toBe(true);
  });
  it('evicts 404 details and public summaries', async () => {
    const { service, detail } = setup();
    detail.mockRejectedValue(new GalleryApiClientError('not-found'));
    expect((await service.getAsset({ productId: 1 })).unwrapErr()).toMatchObject({
      type: 'exchange-not-found',
    });
    const search = (await service.search({ query: 'workbook' })).unwrap();
    expect(search.data.results.map((result) => result.asset.id)).toEqual([2]);
  });
  it('lists only used categories and rejects invalid queries before upstream reads', async () => {
    const { service, list } = setup();
    expect((await service.search({ query: '!!!' })).unwrapErr()).toMatchObject({
      type: 'exchange-input',
    });
    expect(list).not.toHaveBeenCalled();
    const facets = (await service.listCategories({ assetType: 'skill' })).unwrap();
    expect(facets.data.scope).toBe('published-used');
    expect(facets.data.groups[0].tags).toHaveLength(1);
    expect(facets.data.groups[0].tags[0].assetCount).toBe(2);
  });
  it('singleflights detail reads, expires them by TTL, and bounds retained entries', async () => {
    const { client, detail } = setup();
    let now = 1_000;
    const service = new ExchangeDiscoveryService({
      client,
      options: { ...config.options, detailCacheMaxEntries: 1 },
      now: () => now,
    });
    await Promise.all([service.getAsset({ productId: 1 }), service.getAsset({ productId: 1 })]);
    expect(detail).toHaveBeenCalledTimes(1);
    await service.getAsset({ productId: 1 });
    expect(detail).toHaveBeenCalledTimes(1);
    await service.getAsset({ productId: 2 });
    await service.getAsset({ productId: 1 });
    expect(detail).toHaveBeenCalledTimes(3);
    now += 300_001;
    await service.getAsset({ productId: 1 });
    expect(detail).toHaveBeenCalledTimes(4);
  });
  it('does not expose a catalog member whose detail publication moved into the future', async () => {
    const { service, detail } = setup();
    detail.mockResolvedValue({ ...products[0], publish_date: '2099-01-01T00:00:00.000Z' });
    expect((await service.getAsset({ productId: 1 })).unwrapErr()).toMatchObject({
      type: 'exchange-not-found',
    });
  });
  it('reports missing types and does not report absent IDs as known not-found in a partial catalog', async () => {
    const { service, list } = setup();
    const prior = list.getMockImplementation();
    list.mockImplementation(async (params) => {
      if (params.type === 'connector') throw new GalleryApiClientError('unavailable');
      return await prior!(params);
    });
    const search = (await service.search({ query: 'workbook' })).unwrap();
    expect(search.meta.missingProductTypes).toEqual(['connector']);
    expect((await service.getAsset({ productId: 99 })).unwrapErr()).toMatchObject({
      type: 'exchange-unavailable',
    });
  });
  it('validates comparison cardinality and membership before any detail fanout', async () => {
    const { service, list, detail } = setup();
    for (const productIds of [[1], [1, 2, 3, 4, 5], [1, -1], [1, 1]]) {
      expect((await service.compare({ productIds })).unwrapErr()).toMatchObject({
        type: 'exchange-input',
      });
    }
    expect(list).not.toHaveBeenCalled();
    expect((await service.compare({ productIds: [1, 99] })).unwrapErr()).toMatchObject({
      type: 'exchange-not-found',
    });
    expect(detail).not.toHaveBeenCalled();
  });
  it('returns a controlled comparison error when one member detail fails', async () => {
    const { service, detail } = setup();
    detail.mockImplementation(async ({ productId }) => {
      if (productId === 2) throw new GalleryApiClientError('unavailable');
      return products[0];
    });
    const result = await service.compare({ productIds: [1, 2] });
    expect(result.unwrapErr()).toMatchObject({ type: 'exchange-unavailable' });
    expect(detail).toHaveBeenCalledTimes(2);
    expect((await service.getAsset({ productId: 1 })).isOk()).toBe(true);
  });
  it('falls back to catalog tags with explicit provenance when supplemental labels fail', async () => {
    const { service, client } = setup();
    vi.mocked(client.listTags).mockRejectedValue(new GalleryApiClientError('unavailable'));
    const facets = (
      await service.listCategories({ assetType: 'skill', tagType: 'category' })
    ).unwrap();
    expect(facets.data.scope).toBe('published-used');
    expect(facets.data.groups).toEqual([
      {
        type: 'category',
        tags: [
          {
            id: 10,
            name: 'Build and Design',
            canonicalName: 'Build and Design',
            type: 'category',
            applicableProductType: 'skill',
            assetCount: 2,
          },
        ],
      },
    ]);
    expect(facets.meta.warnings).toContain(
      'Supplemental tag labels are unavailable; using catalog tags.',
    );
  });

  it.each([{ tags: ['!!!'] }, { tags: ['Free', '!!!'] }, { tags: ['—'] }])(
    'rejects normalized-empty tags before any Gallery call: %j',
    async ({ tags }) => {
      const { service, client, list, detail } = setup();
      for (const query of ['', 'workbook']) {
        expect((await service.search({ query, tags })).unwrapErr()).toMatchObject({
          type: 'exchange-input',
          message: 'Every tag filter must contain searchable text.',
        });
      }
      expect(list).not.toHaveBeenCalled();
      expect(detail).not.toHaveBeenCalled();
      expect(client.listTags).not.toHaveBeenCalled();
    },
  );

  it('returns localized connector instructions in detail and comparison through the real client', async () => {
    const connectors = [1, 2].map((id) => ({
      id,
      name: `Connector ${id}`,
      product_type: 'connector',
      publisher_name: 'Vendor',
      typed_tags: [],
      community_contribution: false,
      details: {
        installation_instructions: `English instructions ${id}`,
        installation_instructions_fr_fr: id === 1 ? '<p>Instructions françaises</p>' : '',
        driver_download_url: 'https://private.invalid/driver.taco',
      },
    }));
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (request) => {
      const url = new URL(String(request));
      const product = connectors.find((candidate) => url.pathname === `/products/${candidate.id}`);
      return new Response(
        JSON.stringify(
          product ?? {
            items:
              url.searchParams.get('type') === 'connector' &&
              url.searchParams.get('page') === '1' &&
              url.searchParams.get('include_community') === 'false'
                ? connectors
                : [],
            page: Number(url.searchParams.get('page')),
            per_page: 2,
            total: null,
          },
        ),
      );
    });
    const client = new GalleryApiClient({ apiBaseUrl: config.apiBaseUrl, timeoutMs: 20, fetchFn });
    const service = new ExchangeDiscoveryService({
      client,
      options: { ...config.options, locale: 'fr_fr' },
    });
    const detail = (await service.getAsset({ productId: 1 })).unwrap();
    expect(detail.data.details).toEqual({
      kind: 'connector',
      installationInstructions: 'Instructions françaises',
    });
    const comparison = (await service.compare({ productIds: [1, 2] })).unwrap();
    expect(comparison.data.assets.map((asset) => asset.details)).toEqual([
      { kind: 'connector', installationInstructions: 'Instructions françaises' },
      { kind: 'connector', installationInstructions: 'English instructions 2' },
    ]);
    expect(
      fetchFn.mock.calls.every(
        ([url]) => new URL(String(url)).searchParams.get('lang') === 'fr_fr',
      ),
    ).toBe(true);
    expect(JSON.stringify(comparison)).not.toMatch(/driver|instructions_fr_fr|private/);
  });
});
