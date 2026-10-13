import { Err, Ok } from 'ts-results-es';

import {
  ExchangeInputError,
  ExchangeNotFoundError,
  ExchangeUnavailableError,
} from '../../errors/mcpToolError.js';
import { galleryProductSchema } from '../../exchange/gallery/galleryApiSchemas.js';
import { normalizeProduct } from '../../exchange/gallery/ProductNormalizer.js';
import { CatalogMeta } from '../../exchange/types.js';
import { Tool } from '../tool.js';
import { getGetExchangeAssetTool } from './getExchangeAsset.js';
import { getSearchExchangeAssetsTool } from './searchExchangeAssets.js';
import { getMockExchangeServer, getMockRequestHandlerExtra } from './toolContext.mock.js';

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

describe('ExchangeTool result boundary', () => {
  it('emits schema-validated structured content and matching readable text', async () => {
    const server = getMockExchangeServer();
    const tool = getSearchExchangeAssetsTool(server);
    const response = { data: { results: [], totalMatches: 0 }, meta };
    const result = await tool.logAndExecute({
      args: { query: 'export' },
      extra: getMockRequestHandlerExtra(server),
      callback: async () => new Ok(response),
    });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual(response);
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(response) }]);
  });

  it.each([
    new ExchangeInputError('Provide a meaningful catalog filter.'),
    new ExchangeNotFoundError(),
    new ExchangeUnavailableError(),
  ])('renders typed errors without success data', async (error) => {
    const server = getMockExchangeServer();
    const result = await getSearchExchangeAssetsTool(server).logAndExecute({
      args: { query: 'export' },
      extra: getMockRequestHandlerExtra(server),
      callback: async () => new Err(error),
    });
    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: error.getErrorText() }],
    });
    expect(result.structuredContent).toBeUndefined();
  });

  it('redacts query, publisher, tags and IDs before invoking the shared notifier', () => {
    const notify = vi.spyOn(Tool.prototype, 'notifyInvocation').mockImplementation(() => {});
    const server = getMockExchangeServer();
    getSearchExchangeAssetsTool(server).notifyInvocation({
      requestId: 7,
      args: {
        query: 'sensitive query',
        publisher: 'private publisher',
        tags: ['private tag'],
        productIds: [1000, 1001],
      },
    });
    getGetExchangeAssetTool(server).notifyInvocation({ requestId: 8, args: { productId: 1000 } });
    expect(notify.mock.calls).toEqual([
      [{ requestId: 7, args: { queryLength: 15 } }],
      [{ requestId: 8, args: { queryLength: undefined } }],
    ]);
    notify.mockRestore();
  });

  it('contains unexpected upstream exceptions without exposing bodies or URLs', async () => {
    const server = getMockExchangeServer();
    const result = await getSearchExchangeAssetsTool(server).logAndExecute({
      args: { query: 'private query' },
      extra: getMockRequestHandlerExtra(server),
      callback: async () => {
        throw new Error('private body https://private.invalid/?token=secret');
      },
    });
    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: new ExchangeUnavailableError().getErrorText() }],
    });
    expect(JSON.stringify(result)).not.toMatch(/private|token|secret/);
  });

  it.each([
    { data: { results: null, totalMatches: 0 }, meta },
    { data: { results: [], totalMatches: -1 }, meta },
    { data: { results: [], totalMatches: 0 }, meta: { ...meta, source: 'production-certified' } },
    { data: { results: [], totalMatches: 0 }, meta, manifestFileName: 'private.tskill' },
  ])('rejects malformed or extra success fields before emitting them', async (response) => {
    const server = getMockExchangeServer();
    const result = await getSearchExchangeAssetsTool(server).logAndExecute({
      args: { query: 'export' },
      extra: getMockRequestHandlerExtra(server),
      callback: async () => new Ok(response),
    });
    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: new ExchangeUnavailableError().getErrorText() }],
    });
    expect(result.structuredContent).toBeUndefined();
  });

  it('rejects nested package fields in otherwise valid detail output', async () => {
    const server = getMockExchangeServer();
    const result = await getGetExchangeAssetTool(server).logAndExecute({
      args: { productId: 4000 },
      extra: getMockRequestHandlerExtra(server),
      callback: async () =>
        new Ok({
          data: {
            id: 4000,
            type: 'connector',
            name: 'PostgreSQL Connector',
            shortDescription: 'Connect to PostgreSQL.',
            publisher: { id: 1, name: 'Fixture Publisher' },
            tags: [],
            listingUrl: 'https://exchange.example/products/4000',
            communityContribution: false,
            technicalMetadataStatus: 'available',
            details: {
              kind: 'connector',
              versionNumber: '1.2',
              driver_download_url: 'https://private.invalid/driver.zip',
            },
          },
          meta,
        }),
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('driver');
  });

  it.each([
    'products/1000:download',
    'extensions/1000:download',
    'viz/1000:download',
    'connectors/1000:download',
    'submissions/1000:download',
    'products/1000:getdownloadurl',
    'products/1000%3Adownload',
    'products%2F1000%253Agetdownloadurl',
  ])(
    'omits Gallery artifact links from structured content and serialized text: %s',
    async (path) => {
      const server = getMockExchangeServer();
      const artifactUrl = `https://gallery.example/api/${path}`;
      const publicSupport = 'https://support.example/help';
      const raw = galleryProductSchema.parse({
        id: 1000,
        name: 'Connector',
        product_type: 'connector',
        publisher_name: 'Vendor',
        typed_tags: [],
        community_contribution: false,
        support_url: artifactUrl,
        privacy_policy: publicSupport,
        short_description: `Read ${artifactUrl}`,
        detailed_description: `Read ${artifactUrl} or ${publicSupport}`,
        details: { installation_instructions: `Use ${artifactUrl}` },
      });
      const response = {
        data: normalizeProduct(raw, new URL('https://exchange.example/'), 'detail'),
        meta,
      };
      const result = await getGetExchangeAssetTool(server).logAndExecute({
        args: { productId: 1000 },
        extra: getMockRequestHandlerExtra(server),
        callback: async () => new Ok(response),
      });
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toEqual(response);
      expect(JSON.stringify(result.structuredContent)).not.toContain(artifactUrl);
      expect(result.content).toEqual([
        { type: 'text', text: JSON.stringify(result.structuredContent) },
      ]);
      expect(JSON.stringify(result.content)).not.toContain(artifactUrl);
      expect(JSON.stringify(result.structuredContent)).toContain(publicSupport);
      expect(JSON.stringify(result.content)).toContain('https://exchange.example/products/1000');
    },
  );
});
