import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { CatalogMeta, CompareData, ExchangeAsset } from '../../exchange/types.js';
import { Provider } from '../../utils/provider.js';
import { getCompareExchangeAssetsTool } from './compareExchangeAssets.js';
import { getMockExchangeServer, getMockRequestHandlerExtra } from './toolContext.mock.js';

describe('compare-exchange-assets', () => {
  it('preserves caller order and unknown comparison fields from the service', async () => {
    const server = getMockExchangeServer();
    const assets: ExchangeAsset[] = [1001, 1000].map((id) => ({
      id,
      type: 'skill',
      name: `Fixture Skill ${id}`,
      shortDescription: 'Listing metadata only.',
      publisher: { id: null, name: 'Fixture Publisher' },
      tags: [],
      listingUrl: `https://exchange.example/products/${id}`,
      communityContribution: true,
      technicalMetadataStatus: 'unavailable',
    }));
    const data: CompareData = {
      assets,
      dimensions: assets.map((asset) => ({
        productId: asset.id,
        type: asset.type,
        publisher: asset.publisher.name,
        tags: [],
        minimumTableauVersion: null,
        downloads: null,
        supportUrl: null,
        communityContribution: true,
      })),
    };
    const meta: CatalogMeta = {
      generatedAt: '2026-01-01T00:00:00.000Z',
      catalogLoadedAt: '2026-01-01T00:00:00.000Z',
      catalogAssetCount: 2,
      partialProductTypes: [],
      missingProductTypes: [],
      staleProductTypes: [],
      source: 'declared-fixture',
      cacheAgeSeconds: 0,
      stale: false,
      warnings: [],
    };
    const response = { data, meta };
    const compare = vi.spyOn(server.service, 'compare').mockResolvedValue(new Ok(response));
    const callback = await Provider.from(getCompareExchangeAssetsTool(server).callback);
    const result = await callback({ productIds: [1001, 1000] }, getMockRequestHandlerExtra(server));
    expect(compare).toHaveBeenCalledExactlyOnceWith({ productIds: [1001, 1000] });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual(response);
  });

  it('requires two to four distinct safe positive IDs', async () => {
    const tool = getCompareExchangeAssetsTool(getMockExchangeServer());
    const shape = await Provider.from(tool.paramsSchema);
    expect(shape.productIds.description).toContain('order');
    const schema = z.object(shape);
    expect(schema.safeParse({ productIds: [4, 3, 2, 1] }).success).toBe(true);
    for (const productIds of [
      [],
      [1],
      [1, 1],
      [1, 2, 3, 4, 5],
      [0, 1],
      [1.5, 2],
      ['1', '2'],
      [1, Number.MAX_SAFE_INTEGER + 1],
    ]) {
      expect(schema.safeParse({ productIds }).success).toBe(false);
    }
    expect(await Provider.from(tool.description)).toContain('Unknown values remain null');
  });
});
