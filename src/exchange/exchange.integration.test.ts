import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  CallToolResultSchema,
  LoggingMessageNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { exchangeToolNames } from '../tools/exchange/toolName.js';
import { CompareData, ExchangeAsset, FacetData, SearchData, ToolResponse } from './types.js';

type FixtureGallery = {
  url: string;
  fixture: { products: Array<Record<string, unknown>> };
  requests: Array<{ method: string; pathname: string; query: Record<string, string> }>;
  close: () => Promise<void>;
};
describe('Exchange MCP stdio interoperability', () => {
  it('discovers all five types, reads/compares Skills, exposes used categories and invokes only existing GET routes', async () => {
    const module = (await import(
      pathToFileURL(resolve('docs/scripts/demo-exchange-gallery.mjs')).href
    )) as { startFixtureGallery: () => Promise<FixtureGallery> };
    const gallery = await module.startFixtureGallery();
    // Exercise reachable upstream fields without changing the reusable fixture file.
    const artifactUrl = `${gallery.url}products/2000:download`;
    const extension = gallery.fixture.products.find((product) => product.id === 2000)!;
    extension.support_url = artifactUrl;
    extension.short_description = `Export dashboards. Package ${artifactUrl}`;
    const connector = gallery.fixture.products.find((product) => product.id === 4000)!;
    connector.details = {
      ...(connector.details as Record<string, unknown>),
      installation_instructions_fr_fr: `<p>Instructions françaises ${artifactUrl}</p>`,
      installation_instructions_fr_ca: 'Unselected private locale',
      private_detail_field: 'private-detail-marker',
    };
    const notifications: string[] = [];
    const client = new Client({ name: 'exchange-fixture-test', version: '1.0' });
    client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
      notifications.push(JSON.stringify(notification.params.data));
    });
    const transport = new StdioClientTransport({
      command: process.execPath,
      cwd: process.cwd(),
      stderr: 'pipe',
      args:
        process.env.EXCHANGE_TEST_BUILD === 'true'
          ? ['build/index.exchange.js']
          : ['--import', 'tsx', 'src/index.exchange.ts'],
      env: {
        TRANSPORT: 'stdio',
        MCP_TRANSPORT: 'stdio',
        GALLERY_API_BASE_URL: gallery.url,
        EXCHANGE_WEB_BASE_URL: 'https://fixture.exchange.invalid/',
        EXCHANGE_CATALOG_SOURCE: 'declared-fixture',
        EXCHANGE_LOCALE: 'fr-FR',
        GALLERY_API_TIMEOUT_MS: '1000',
        PRODUCT_PAGE_SIZE: '2',
      },
    });
    const call = async <T>(
      name: string,
      args: Record<string, unknown>,
    ): Promise<ToolResponse<T>> => {
      const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toBeDefined();
      expect(JSON.stringify(result.structuredContent)).not.toContain(artifactUrl);
      expect(JSON.stringify(result.content)).not.toContain(artifactUrl);
      expect(JSON.stringify(result)).not.toMatch(
        /private-detail-marker|Unselected private locale|installation_instructions_fr_fr/,
      );
      const text = result.content.find((content) => content.type === 'text');
      expect(text?.type === 'text' ? JSON.parse(text.text) : undefined).toEqual(
        result.structuredContent,
      );
      return result.structuredContent as unknown as ToolResponse<T>;
    };
    try {
      await client.connect(transport);
      expect(client.getServerVersion()?.name).toBe('tableau-exchange-mcp');
      expect(client.getServerCapabilities()?.extensions).toBeUndefined();
      const tools = (await client.listTools()).tools;
      expect(tools.map((tool) => tool.name)).toEqual(exchangeToolNames);
      for (const tool of tools) {
        expect(tool.outputSchema).toBeDefined();
        expect(tool.annotations).toMatchObject({
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        });
      }
      for (const tags of [['!!!'], ['Free', '!!!']]) {
        const invalidTags = await client.callTool({
          name: 'search-exchange-assets',
          arguments: { query: '', tags },
        });
        expect(invalidTags.isError).toBe(true);
        expect(JSON.stringify(invalidTags.content)).toContain(
          'Every tag filter must contain searchable text.',
        );
      }
      expect(gallery.requests).toEqual([]);
      const browse = await call<SearchData>('search-exchange-assets', {
        query: '',
        assetTypes: ['skill', 'extension', 'viz', 'connector', 'accelerator'],
        limit: 10,
      });
      expect(new Set(browse.data.results.map((result) => result.asset.type))).toEqual(
        new Set(['skill', 'extension', 'viz', 'connector', 'accelerator']),
      );
      expect(browse.meta).toMatchObject({
        source: 'declared-fixture',
        partialProductTypes: [],
        catalogAssetCount: 12,
      });
      const search = await call<SearchData>('search-exchange-assets', {
        query: 'workbook',
        assetTypes: ['skill'],
      });
      expect(search.data.results[0].asset.id).toBe(1003);
      expect(search.data.results[0].reasons.length).toBeGreaterThan(0);
      const detail = await call<ExchangeAsset>('get-exchange-asset', { productId: 1003 });
      expect(detail.data.technicalMetadataStatus).toBe('unavailable');
      expect(detail.data.details).toBeUndefined();
      expect(detail.data.listingUrl).toBe('https://fixture.exchange.invalid/products/1003');
      const extensionDetail = await call<ExchangeAsset>('get-exchange-asset', { productId: 2000 });
      expect(extensionDetail.data.supportUrl).toBeUndefined();
      expect(extensionDetail.data.shortDescription).toContain('[link omitted]');
      const localized = await call<ExchangeAsset>('get-exchange-asset', { productId: 4000 });
      expect(localized.data.details).toMatchObject({
        kind: 'connector',
        installationInstructions: 'Instructions françaises [link omitted]',
      });
      const compare = await call<CompareData>('compare-exchange-assets', {
        productIds: [4000, 1003],
      });
      expect(compare.data.assets.map((asset) => asset.id)).toEqual([4000, 1003]);
      expect(compare.data.dimensions[1].minimumTableauVersion).toBeNull();
      expect(compare.data.assets[0].details).toMatchObject({
        kind: 'connector',
        versionNumber: '1.2',
        dataSourceClass: 'postgres',
        installationInstructions: 'Instructions françaises [link omitted]',
      });
      const facets = await call<FacetData>('list-exchange-categories', {
        assetType: 'skill',
        tagType: 'category',
      });
      expect(facets.data.groups[0].tags).toHaveLength(7);
      expect(facets.data.groups[0].tags.map((tag) => tag.canonicalName)).toContain(
        'Build and Design',
      );
      expect(facets.data.scope).toBe('published-used');
      const privateQuery = 'private billing workbook';
      await call<SearchData>('search-exchange-assets', { query: privateQuery });
      expect(notifications.some((value) => value.includes('queryLength'))).toBe(true);
      expect(notifications.join(' ')).not.toContain(privateQuery);
      expect(JSON.stringify([browse, detail, compare, facets])).not.toMatch(
        /manifest_file_name|product_download_url|driver_download_url|X-Amz-Signature|placeholder_details/,
      );
      expect(
        gallery.requests.every(
          (request) =>
            request.method === 'GET' && /^(?:\/products(?:\/\d+)?|\/tags)$/.test(request.pathname),
        ),
      ).toBe(true);
      expect(gallery.requests.some((request) => request.pathname === '/tags')).toBe(true);
      expect(gallery.requests.every((request) => request.query.lang === 'fr_fr')).toBe(true);
      const invalid = await client.callTool({
        name: 'compare-exchange-assets',
        arguments: { productIds: [1003, 1003] },
      });
      expect(invalid.isError).toBe(true);
    } finally {
      await client.close();
      await gallery.close();
    }
  }, 30_000);
});
