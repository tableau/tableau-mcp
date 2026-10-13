import { BaseConfig } from './config.shared.js';
import { ExchangeRuntimeOptions } from './exchange/types.js';

const locales = [
  'en_us',
  'ja_jp',
  'ko_kr',
  'fr_ca',
  'fr_fr',
  'it_it',
  'es_es',
  'de_de',
  'zh_tw',
  'zh_cn',
  'en_gb',
  'pt_br',
  'sv_se',
  'th_th',
  'nl_nl',
];

export class ExchangeConfig extends BaseConfig {
  readonly apiBaseUrl: URL;
  readonly options: ExchangeRuntimeOptions;

  constructor(env: Record<string, string | undefined> = process.env) {
    super();
    if (
      [env.TRANSPORT, env.MCP_TRANSPORT].some((value) => value !== undefined && value !== 'stdio')
    )
      throw new Error('Exchange supports only stdio transport.');
    this.transport = 'stdio';
    const url = (name: string): URL => {
      const value = env[name];
      if (!value) throw new Error(`${name} is required.`);
      let result: URL;
      try {
        result = new URL(value);
      } catch {
        throw new Error(`${name} must be a valid URL.`);
      }
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(result.hostname);
      if (
        (result.protocol !== 'https:' && !(result.protocol === 'http:' && loopback)) ||
        result.username ||
        result.password ||
        result.search ||
        result.hash ||
        !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]*\/?$/.test(result.pathname)
      )
        throw new Error(
          `${name} must be HTTPS, or HTTP on loopback, without credentials, query or fragment.`,
        );
      return result;
    };
    const integer = (name: string, fallback: number, min: number, max: number): number => {
      if (env[name] === undefined) return fallback;
      const value = Number(env[name]);
      if (!env[name]?.trim() || !Number.isInteger(value) || value < min || value > max)
        throw new Error(`${name} must be an integer from ${min} to ${max}.`);
      return value;
    };
    const locale = (env.EXCHANGE_LOCALE ?? 'en_US').toLowerCase().replaceAll('-', '_');
    if (!locales.includes(locale)) throw new Error('Unsupported EXCHANGE_LOCALE.');
    const source = env.EXCHANGE_CATALOG_SOURCE ?? 'gallery-api';
    if (source !== 'gallery-api' && source !== 'declared-fixture')
      throw new Error('EXCHANGE_CATALOG_SOURCE must be gallery-api or declared-fixture.');
    this.apiBaseUrl = url('GALLERY_API_BASE_URL');
    this.options = {
      webBaseUrl: url('EXCHANGE_WEB_BASE_URL'),
      locale,
      source,
      catalogTtlMs: integer('CATALOG_CACHE_TTL_SECONDS', 300, 1, 3_600) * 1_000,
      timeoutMs: integer('GALLERY_API_TIMEOUT_MS', 5_000, 1, 60_000),
      pageSize: integer('PRODUCT_PAGE_SIZE', 1_000, 2, 1_000),
      maxSearchResults: integer('MAX_SEARCH_RESULTS', 10, 1, 10),
      maxPagesPerType: integer('MAX_CATALOG_PAGES_PER_TYPE', 100, 1, 100),
      maxCatalogAssets: integer('MAX_CATALOG_ASSETS', 10_000, 1, 10_000),
      detailCacheMaxEntries: integer('DETAIL_CACHE_MAX_ENTRIES', 500, 1, 500),
    };
  }
}

export const getExchangeConfig = (env?: Record<string, string | undefined>): ExchangeConfig =>
  new ExchangeConfig(env);
