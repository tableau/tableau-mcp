import { homedir } from 'node:os';
import { join } from 'node:path';

import { getExchangeConfig } from './config.exchange.js';

const settings = {
  GALLERY_API_BASE_URL: 'http://127.0.0.1:3928/',
  EXCHANGE_WEB_BASE_URL: 'https://exchange.example/',
};
describe('Exchange config', () => {
  it('has its own no-auth defaults and normalizes supported locale', () => {
    const config = getExchangeConfig({
      ...settings,
      EXCHANGE_LOCALE: 'fr-FR',
      EXCHANGE_CATALOG_SOURCE: 'declared-fixture',
    });
    expect(config.options).toMatchObject({
      locale: 'fr_fr',
      catalogTtlMs: 300_000,
      pageSize: 1_000,
      maxSearchResults: 10,
      source: 'declared-fixture',
    });
    expect(config.transport).toBe('stdio');
  });
  it.each([
    { TRANSPORT: 'http' },
    { MCP_TRANSPORT: 'streamable-http' },
    { MCP_TRANSPORT: 'other' },
    { EXCHANGE_LOCALE: 'xx_XX' },
    { PRODUCT_PAGE_SIZE: '1' },
    { MAX_SEARCH_RESULTS: '11' },
    { GALLERY_API_BASE_URL: 'https://user:password@example.test/' },
  ])('rejects unsupported or unsafe config %j', (invalid) => {
    expect(() => getExchangeConfig({ ...settings, ...invalid })).toThrow();
  });
  it('saves downloads under the user Downloads folder unless an absolute directory is set', () => {
    expect(getExchangeConfig(settings).options.downloadDir).toBe(
      join(homedir(), 'Downloads', 'tableau-exchange'),
    );
    expect(
      getExchangeConfig({ ...settings, EXCHANGE_DOWNLOAD_DIR: '/tmp/exchange' }).options
        .downloadDir,
    ).toBe('/tmp/exchange');
    expect(() => getExchangeConfig({ ...settings, EXCHANGE_DOWNLOAD_DIR: 'relative/dir' })).toThrow(
      'EXCHANGE_DOWNLOAD_DIR must be an absolute path.',
    );
  });
  it('requires both API and matching website configuration', () => {
    expect(() =>
      getExchangeConfig({ GALLERY_API_BASE_URL: settings.GALLERY_API_BASE_URL }),
    ).toThrow('EXCHANGE_WEB_BASE_URL is required');
  });
});
