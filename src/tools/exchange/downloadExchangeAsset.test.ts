import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { CatalogMeta, DownloadData } from '../../exchange/types.js';
import { Provider } from '../../utils/provider.js';
import { getDownloadExchangeAssetTool } from './downloadExchangeAsset.js';
import { downloadAnnotations } from './tool.js';
import { getMockExchangeServer, getMockRequestHandlerExtra } from './toolContext.mock.js';

describe('download-exchange-asset', () => {
  it('delegates the catalog ID and returns where the file was saved', async () => {
    const server = getMockExchangeServer();
    const data: DownloadData = {
      productId: 900002,
      type: 'skill',
      name: 'Flowchart Builder',
      fileName: 'flowchart-builder.tskill',
      path: '/tmp/tableau-exchange/900002/flowchart-builder.tskill',
      bytes: 512,
      sha256: 'a'.repeat(64),
      listingUrl: 'https://exchange.example/products/900002',
      nextStep: 'Review SKILL.md.',
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
    const download = vi.spyOn(server.service, 'download').mockResolvedValue(new Ok({ data, meta }));
    const callback = await Provider.from(getDownloadExchangeAssetTool(server).callback);
    const result = await callback({ productId: 900002 }, getMockRequestHandlerExtra(server));
    expect(download).toHaveBeenCalledExactlyOnceWith({ productId: 900002 });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({ data, meta });
  });

  it('is annotated as a non-read-only tool so clients ask before downloading', async () => {
    const tool = getDownloadExchangeAssetTool(getMockExchangeServer());
    expect(await Provider.from(tool.annotations)).toEqual(downloadAnnotations);
    expect(downloadAnnotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    const description = await Provider.from(tool.description);
    expect(description).toContain('never opened, extracted, installed or run');
    const schema = z.object(await Provider.from(tool.paramsSchema));
    expect(schema.safeParse({ productId: 1 }).success).toBe(true);
    for (const productId of [0, 1.5, '1'])
      expect(schema.safeParse({ productId }).success).toBe(false);
  });
});
