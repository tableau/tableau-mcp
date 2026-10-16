import { getExchangeConfig } from '../../config.exchange.js';
import { GalleryApiClient, GalleryApiClientError } from '../gallery/GalleryApiClient.js';
import {
  GalleryListProducts,
  GalleryProduct,
  galleryProductSchema,
} from '../gallery/galleryApiSchemas.js';
import { CatalogCache } from './CatalogCache.js';

const config = getExchangeConfig({
  GALLERY_API_BASE_URL: 'https://gallery.example/',
  EXCHANGE_WEB_BASE_URL: 'https://exchange.example/',
  PRODUCT_PAGE_SIZE: '2',
});
const product = (id: number): GalleryProduct =>
  galleryProductSchema.parse({
    id,
    product_type: 'skill',
    name: `Skill ${id}`,
    publisher_name: 'Vendor',
    typed_tags: [],
    community_contribution: true,
  });
const page = (products: ReturnType<typeof product>[], value: number): GalleryListProducts => ({
  products,
  page: value,
  per_page: 2,
  total: null,
  next: null,
});
describe('CatalogCache', () => {
  it('continues across empty official partitions/null next and singleflights concurrent callers', async () => {
    const client = new GalleryApiClient({ apiBaseUrl: config.apiBaseUrl, timeoutMs: 20 });
    const list = vi
      .spyOn(client, 'listProducts')
      .mockImplementation(async ({ type, page: number, community }) =>
        page(
          type === 'skill' && community
            ? number === 1
              ? [product(1), product(2)]
              : number === 2
                ? [product(3)]
                : []
            : [],
          number,
        ),
      );
    const cache = new CatalogCache(client, config.options);
    const [first, second] = await Promise.all([cache.load(), cache.load()]);
    expect(first.assets.map((asset) => asset.id)).toEqual([1, 2, 3]);
    expect(second.assets).toEqual(first.assets);
    expect(list).toHaveBeenCalledTimes(12);
    expect(first.available).toBe(true);
    expect(first.types.get('skill')?.partial).toBe(false);
  });
  it('distinguishes valid empty, initial all-failure, and stale refresh with truthful age', async () => {
    const client = new GalleryApiClient({ apiBaseUrl: config.apiBaseUrl, timeoutMs: 20 });
    const list = vi.spyOn(client, 'listProducts').mockResolvedValue(page([], 1));
    let now = 1_000;
    const cache = new CatalogCache(client, config.options, () => now);
    const initial = await cache.load();
    expect(initial.available).toBe(true);
    expect(initial.assets).toEqual([]);
    now += 300_001;
    list.mockRejectedValue(new GalleryApiClientError('unavailable'));
    const stale = await cache.load();
    expect(stale.loadedAt).toBe(1_000);
    expect([...stale.types.values()].every((state) => state.stale)).toBe(true);
    const failed = await new CatalogCache(client, config.options).load();
    expect(failed.available).toBe(false);
    expect([...failed.types.values()].every((state) => state.missing)).toBe(true);
  });
  it('marks repeated pages and configured bounds partial rather than silently complete', async () => {
    const client = new GalleryApiClient({ apiBaseUrl: config.apiBaseUrl, timeoutMs: 20 });
    vi.spyOn(client, 'listProducts').mockImplementation(async ({ type, page: number, community }) =>
      page(type === 'skill' && community ? [product(1), product(2)] : [], number),
    );
    const snapshot = await new CatalogCache(client, config.options).load();
    expect(snapshot.assets).toHaveLength(2);
    expect(snapshot.types.get('skill')?.partial).toBe(true);
    const limited = await new CatalogCache(client, {
      ...config.options,
      maxCatalogAssets: 1,
    }).load();
    expect(limited.assets).toHaveLength(1);
    expect(limited.types.get('skill')?.partial).toBe(true);
  });
  it('retains the failed type with its original age while updating unaffected types', async () => {
    const client = new GalleryApiClient({ apiBaseUrl: config.apiBaseUrl, timeoutMs: 20 });
    let refreshed = false;
    const list = vi
      .spyOn(client, 'listProducts')
      .mockImplementation(async ({ type, page: number, community }) => {
        if (refreshed && type === 'skill') throw new GalleryApiClientError('unavailable');
        const items =
          number === 1 && !community
            ? type === 'skill'
              ? [product(1)]
              : type === 'extension'
                ? [{ ...product(refreshed ? 20 : 10), product_type: 'extension' as const }]
                : []
            : [];
        return page(items, number);
      });
    let now = 1_000;
    const cache = new CatalogCache(client, config.options, () => now);
    const initial = await cache.load();
    expect(initial.assets.map((asset) => asset.id)).toEqual([1, 10]);
    await cache.load();
    expect(list).toHaveBeenCalledTimes(10);
    now += 300_001;
    refreshed = true;
    const snapshot = await cache.load();
    expect(snapshot.assets.map((asset) => asset.id)).toEqual([1, 20]);
    expect(snapshot.types.get('skill')).toMatchObject({
      loadedAt: 1_000,
      partial: true,
      stale: true,
      missing: false,
    });
    expect(snapshot.types.get('extension')).toMatchObject({
      loadedAt: now,
      partial: false,
      stale: false,
      missing: false,
    });
    expect(snapshot.loadedAt).toBe(1_000);
    expect(snapshot.available).toBe(true);
  });
});
