import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { CatalogMeta, SearchInput } from '../../exchange/types.js';
import { Provider } from '../../utils/provider.js';
import { getSearchExchangeAssetsTool } from './searchExchangeAssets.js';
import { getMockExchangeServer, getMockRequestHandlerExtra } from './toolContext.mock.js';

describe('search-exchange-assets', () => {
  it('delegates every filter to the service and preserves catalog provenance', async () => {
    const server = getMockExchangeServer();
    const meta: CatalogMeta = {
      generatedAt: '2026-01-01T00:00:00.000Z',
      catalogLoadedAt: null,
      catalogAssetCount: 0,
      partialProductTypes: ['skill'],
      missingProductTypes: ['skill'],
      staleProductTypes: [],
      source: 'declared-fixture',
      cacheAgeSeconds: null,
      stale: false,
      warnings: ['Skill catalog is unavailable.'],
    };
    const response = { data: { results: [], totalMatches: 0 }, meta };
    const search = vi.spyOn(server.service, 'search').mockResolvedValue(new Ok(response));
    const tool = getSearchExchangeAssetsTool(server);
    const args = {
      query: 'export dashboard',
      assetTypes: ['extension', 'viz'],
      tags: ['Free'],
      publisher: 'Fixture Tableau Publisher',
      tableauVersion: '2024.1',
      communityContent: 'exclude',
      limit: 3,
    } satisfies SearchInput;
    const callback = await Provider.from(tool.callback);
    const result = await callback(args, getMockRequestHandlerExtra(server));
    expect(search).toHaveBeenCalledExactlyOnceWith(args);
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual(response);
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(response) }]);
  });

  it('publishes described fields and bounded, typed search inputs', async () => {
    const tool = getSearchExchangeAssetsTool(getMockExchangeServer());
    const shape = await Provider.from(tool.paramsSchema);
    const schema = z.object(shape);
    for (const field of Object.values(shape)) expect(field.description).toBeTruthy();
    expect(schema.safeParse({ query: '', assetTypes: ['skill'], limit: 10 }).success).toBe(true);
    for (const args of [
      { query: 'x'.repeat(301) },
      { query: 'export', limit: 11 },
      { query: 'export', limit: 1.5 },
      { query: 'export', assetTypes: [] },
      { query: 'export', assetTypes: ['workbook'] },
      { query: 'export', tags: [' '] },
      { query: 'export', publisher: '' },
      { query: 'export', communityContent: 'all' },
      { query: 'export', tableauVersion: 'latest' },
      {},
    ])
      expect(schema.safeParse(args).success).toBe(false);
    expect(await Provider.from(tool.description)).toContain('untrusted');
    const description = await Provider.from(tool.description);
    expect(description).toContain('1-3 distinctive keywords');
    expect(description).toContain('synonyms');
    expect(await Provider.from(tool.annotations)).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
  });
});
