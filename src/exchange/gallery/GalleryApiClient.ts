import { z } from 'zod';

import { AssetType } from '../types.js';
import {
  galleryAssetTypeSchema,
  GalleryListProducts,
  galleryListProductsSchema,
  galleryListTagsSchema,
  GalleryProduct,
  GalleryTag,
  localizedGalleryProductSchema,
} from './galleryApiSchemas.js';

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const locales = new Set([
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
]);

export class GalleryApiClientError extends Error {
  constructor(readonly kind: 'not-found' | 'unavailable' | 'invalid-response' | 'too-large') {
    super(
      kind === 'not-found'
        ? 'The Exchange listing was not found.'
        : kind === 'invalid-response'
          ? 'The Exchange catalog returned an invalid response.'
          : kind === 'too-large'
            ? 'The Exchange response exceeded the size limit.'
            : 'The Exchange catalog is temporarily unavailable.',
    );
  }
}

export class GalleryApiClient {
  private readonly apiBaseUrl: URL;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor({
    apiBaseUrl,
    timeoutMs,
    fetchFn = fetch,
  }: {
    apiBaseUrl: URL;
    timeoutMs: number;
    fetchFn?: typeof fetch;
  }) {
    const base = new URL(apiBaseUrl.href);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if (
      (base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]*\/?$/.test(base.pathname) ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 60_000
    ) {
      throw new GalleryApiClientError('invalid-response');
    }
    base.pathname = `${base.pathname.replace(/\/$/, '')}/`;
    this.apiBaseUrl = base;
    this.timeoutMs = timeoutMs;
    this.fetchFn = fetchFn;
  }

  async listProducts({
    type,
    locale,
    page,
    perPage,
    community,
  }: {
    type: AssetType;
    locale: string;
    page: number;
    perPage: number;
    community: boolean;
  }): Promise<GalleryListProducts> {
    if (
      !galleryAssetTypeSchema.safeParse(type).success ||
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(perPage) ||
      perPage < 2 ||
      perPage > 1_000 ||
      typeof community !== 'boolean'
    ) {
      throw new GalleryApiClientError('invalid-response');
    }
    const result = await this.get(
      'products',
      {
        digest: 'true',
        type,
        lang: this.locale(locale),
        page: String(page),
        per_page: String(perPage),
        include_community: String(community),
      },
      galleryListProductsSchema,
    );
    if (result.page !== page || result.per_page !== perPage || result.items.length > perPage) {
      throw new GalleryApiClientError('invalid-response');
    }
    return {
      products: result.items,
      page: result.page,
      per_page: result.per_page,
      total: result.total ?? null,
      next: result.next,
    };
  }

  async getProduct({
    productId,
    locale,
  }: {
    productId: number;
    locale: string;
  }): Promise<GalleryProduct> {
    if (!Number.isSafeInteger(productId) || productId < 1) {
      throw new GalleryApiClientError('invalid-response');
    }
    const normalizedLocale = this.locale(locale);
    const product = await this.get(
      `products/${productId}`,
      { lang: normalizedLocale },
      localizedGalleryProductSchema(normalizedLocale),
    );
    if (product.id !== productId) throw new GalleryApiClientError('invalid-response');
    return product;
  }

  async listTags({ locale }: { locale: string }): Promise<GalleryTag[]> {
    return (await this.get('tags', { lang: this.locale(locale) }, galleryListTagsSchema)).tags;
  }

  /**
   * Fetches a listing's package through Gallery's anonymous download route, which streams the
   * file and records one download. Not retried, so a transient failure cannot count twice.
   */
  async downloadProduct({
    productId,
    maxBytes,
  }: {
    productId: number;
    maxBytes: number;
  }): Promise<Uint8Array> {
    if (!Number.isSafeInteger(productId) || productId < 1) {
      throw new GalleryApiClientError('invalid-response');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await this.fetchFn(
        new URL(`products/${productId}:download`, this.apiBaseUrl),
        {
          method: 'POST',
          redirect: 'manual',
          credentials: 'omit',
          headers: { Accept: 'application/octet-stream', 'Content-Type': 'application/json' },
          body: '{}',
          signal: controller.signal,
        },
      );
      this.checkStatus(response);
      return await this.readBody(response, maxBytes, 'too-large');
    } catch (error) {
      if (error instanceof GalleryApiClientError) throw error;
      throw new GalleryApiClientError('unavailable');
    } finally {
      controller.abort();
      clearTimeout(timeout);
    }
  }

  private locale(locale: string): string {
    const normalized = locale.toLowerCase().replaceAll('-', '_');
    if (!locales.has(normalized)) throw new GalleryApiClientError('invalid-response');
    return normalized;
  }

  private async get<T>(
    path: string,
    params: Record<string, string>,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<T> {
    const url = new URL(path, this.apiBaseUrl);
    url.search = new URLSearchParams(params).toString();
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchFn(url, {
          method: 'GET',
          redirect: 'manual',
          credentials: 'omit',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if ((response.status === 429 || response.status >= 500) && attempt === 0) {
          await response.body?.cancel();
          continue;
        }
        this.checkStatus(response);
        const text = new TextDecoder().decode(
          await this.readBody(response, MAX_RESPONSE_BYTES, 'invalid-response'),
        );
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          throw new GalleryApiClientError('invalid-response');
        }
        const result = schema.safeParse(body);
        if (!result.success) throw new GalleryApiClientError('invalid-response');
        return result.data;
      } catch (error) {
        if (error instanceof GalleryApiClientError) throw error;
        if (attempt === 1) throw new GalleryApiClientError('unavailable');
      } finally {
        // Also close an unconsumed 404/redirect/error response body.
        controller.abort();
        clearTimeout(timeout);
      }
    }
    throw new GalleryApiClientError('unavailable');
  }

  private checkStatus(response: Response): void {
    const kind =
      response.status === 404
        ? 'not-found'
        : response.status === 429 || response.status >= 500
          ? 'unavailable'
          : !response.ok || response.redirected
            ? 'invalid-response'
            : undefined;
    if (kind) {
      void response.body?.cancel();
      throw new GalleryApiClientError(kind);
    }
  }

  private async readBody(
    response: Response,
    maxBytes: number,
    oversized: 'invalid-response' | 'too-large',
  ): Promise<Uint8Array> {
    const declaredLength = response.headers.get('content-length');
    if (
      declaredLength !== null &&
      (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)
    ) {
      await response.body?.cancel();
      throw new GalleryApiClientError(
        /^\d+$/.test(declaredLength) ? oversized : 'invalid-response',
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new GalleryApiClientError('invalid-response');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          throw new GalleryApiClientError(oversized);
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks);
  }
}
