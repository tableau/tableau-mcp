import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { CatalogMeta, ExchangeAsset } from '../../exchange/types.js';
import { Provider } from '../../utils/provider.js';
import { getGetExchangeAssetTool } from './getExchangeAsset.js';
import { getMockExchangeServer, getMockRequestHandlerExtra } from './toolContext.mock.js';

describe('get-exchange-asset', () => {
  it('delegates the catalog ID and returns safe typed connector details', async () => {
    const server = getMockExchangeServer();
    const asset: ExchangeAsset = {
      id: 4000,
      type: 'connector',
      name: 'PostgreSQL Connector',
      shortDescription: 'Connect to PostgreSQL.',
      publisher: { id: 1, name: 'Fixture Tableau Publisher' },
      tags: [],
      listingUrl: 'https://exchange.example/products/4000',
      communityContribution: false,
      technicalMetadataStatus: 'available',
      details: {
        kind: 'connector',
        versionNumber: '1.2',
        dataSourceClass: 'postgres',
        installationInstructions: 'See public documentation.',
      },
    };
    const meta: CatalogMeta = {
      generatedAt: '2026-01-01T00:00:00.000Z',
      catalogLoadedAt: '2026-01-01T00:00:00.000Z',
      catalogAssetCount: 1,
      partialProductTypes: [],
      missingProductTypes: [],
      staleProductTypes: [],
      source: 'declared-fixture',
      cacheAgeSeconds: 0,
      stale: false,
      warnings: [],
    };
    const response = { data: asset, meta };
    const getAsset = vi.spyOn(server.service, 'getAsset').mockResolvedValue(new Ok(response));
    const callback = await Provider.from(getGetExchangeAssetTool(server).callback);
    const result = await callback({ productId: 4000 }, getMockRequestHandlerExtra(server));
    expect(getAsset).toHaveBeenCalledExactlyOnceWith({ productId: 4000 });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual(response);
  });

  it('requires a safe positive integer catalog ID and explains the trust boundary', async () => {
    const tool = getGetExchangeAssetTool(getMockExchangeServer());
    const shape = await Provider.from(tool.paramsSchema);
    expect(shape.productId.description).toContain('catalog');
    const schema = z.object(shape);
    expect(schema.safeParse({ productId: 1000 }).success).toBe(true);
    for (const productId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1000', null]) {
      expect(schema.safeParse({ productId }).success).toBe(false);
    }
    expect(schema.safeParse({}).success).toBe(false);
    expect(await Provider.from(tool.description)).toContain(
      'technical metadata is currently unavailable',
    );
    expect(await Provider.from(tool.description)).toContain('untrusted');
  });
});
