import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { CatalogMeta, FacetData } from '../../exchange/types.js';
import { Provider } from '../../utils/provider.js';
import { getListExchangeCategoriesTool } from './listExchangeCategories.js';
import { getMockExchangeServer, getMockRequestHandlerExtra } from './toolContext.mock.js';

describe('list-exchange-categories', () => {
  it('delegates facet filters and preserves canonical names and published-used scope', async () => {
    const server = getMockExchangeServer();
    const data: FacetData = {
      scope: 'published-used',
      groups: [
        {
          type: 'pricing',
          tags: [
            {
              id: 201,
              name: 'Free',
              canonicalName: 'Viz Free',
              type: 'pricing',
              applicableProductType: 'viz',
              assetCount: 1,
            },
          ],
        },
      ],
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
    const response = { data, meta };
    const listCategories = vi
      .spyOn(server.service, 'listCategories')
      .mockResolvedValue(new Ok(response));
    const callback = await Provider.from(getListExchangeCategoriesTool(server).callback);
    const result = await callback(
      { assetType: 'viz', tagType: 'pricing' },
      getMockRequestHandlerExtra(server),
    );
    expect(listCategories).toHaveBeenCalledExactlyOnceWith({
      assetType: 'viz',
      tagType: 'pricing',
    });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual(response);
  });

  it('allows unfiltered facets but rejects unknown types and empty tag types', async () => {
    const tool = getListExchangeCategoriesTool(getMockExchangeServer());
    const shape = await Provider.from(tool.paramsSchema);
    for (const field of Object.values(shape)) expect(field.description).toBeTruthy();
    const schema = z.object(shape);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ assetType: 'skill', tagType: 'category' }).success).toBe(true);
    for (const args of [
      { assetType: 'workbook' },
      { tagType: ' ' },
      { tagType: 'x'.repeat(101) },
    ]) {
      expect(schema.safeParse(args).success).toBe(false);
    }
    expect(await Provider.from(tool.description)).toContain(
      'Unused configured categories are omitted',
    );
    expect(await Provider.from(tool.description)).toContain('Free and Viz Free');
  });
});
