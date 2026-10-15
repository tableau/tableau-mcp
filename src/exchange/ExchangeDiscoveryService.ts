import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import {
  ExchangeDownloadError,
  ExchangeInputError,
  ExchangeNotFoundError,
  ExchangeUnavailableError,
  McpToolError,
} from '../errors/mcpToolError.js';
import { CatalogCache, CatalogSnapshot, CatalogTypeState } from './catalog/CatalogCache.js';
import { exchangeAssetTypes, SearchEngine } from './catalog/SearchEngine.js';
import { GalleryApiClient, GalleryApiClientError } from './gallery/GalleryApiClient.js';
import { galleryAssetTypeSchema } from './gallery/galleryApiSchemas.js';
import { normalizeProduct, normalizeTag } from './gallery/ProductNormalizer.js';
import {
  AssetType,
  CatalogMeta,
  CompareData,
  DownloadData,
  ExchangeAsset,
  ExchangeRuntimeOptions,
  ExchangeTag,
  FacetData,
  SearchData,
  SearchInput,
  ToolResponse,
} from './types.js';

const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const isZip = (file: Buffer): boolean => file.subarray(0, 4).equals(ZIP_SIGNATURE);
// .tskill, .taco and .twbx are ZIP archives; .trex is an XML manifest.
const packageFormats: Record<
  AssetType,
  { extension: string; matches: (file: Buffer) => boolean; nextStep: string }
> = {
  skill: {
    extension: 'tskill',
    matches: isZip,
    nextStep:
      'The .tskill file is a ZIP archive; review its SKILL.md, then follow the listing for how to add the Skill in Tableau.',
  },
  connector: {
    extension: 'taco',
    matches: isZip,
    nextStep:
      'Copy the .taco file into My Tableau Repository/Connectors and restart Tableau. Most connectors also need a database driver from the publisher, linked on the listing page.',
  },
  accelerator: {
    extension: 'twbx',
    matches: isZip,
    nextStep:
      'Open the .twbx packaged workbook in Tableau Desktop, or publish it to Tableau Server or Tableau Cloud.',
  },
  extension: {
    extension: 'trex',
    matches: (file) => isManifest(file),
    nextStep:
      'In a dashboard, add an Extension object, choose Access Local Extensions and select the .trex file. The extension itself runs from the web address in its manifest.',
  },
  viz: {
    extension: 'trex',
    matches: (file) => isManifest(file),
    nextStep:
      'On a worksheet, open the mark type menu on the Marks card, choose Add Extension, then pick the local .trex file. The extension itself runs from the web address in its manifest.',
  },
};
const isManifest = (file: Buffer): boolean =>
  /<manifest[\s>]/.test(file.subarray(0, 4_096).toString('utf8'));
/** The listing name only shapes the file name; it never chooses the directory. */
const fileStem = (asset: ExchangeAsset): string =>
  asset.name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '') || `product-${asset.id}`;

const productIdSchema = z.number().int().positive().safe();
const searchSchema = z.object({
  query: z.string().max(300),
  assetTypes: z.array(galleryAssetTypeSchema).min(1).max(5).optional(),
  tags: z.array(z.string().trim().min(1).max(1_000)).min(1).max(20).optional(),
  publisher: z.string().trim().min(1).max(2_000).optional(),
  tableauVersion: z
    .string()
    .regex(/^\d+\.\d+(?:\.\d+)?$/)
    .optional(),
  communityContent: z.enum(['include', 'exclude', 'only']).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});
const comparisonSchema = z
  .array(productIdSchema)
  .min(2)
  .max(4)
  .refine((ids) => new Set(ids).size === ids.length);

export class ExchangeDiscoveryService {
  private readonly client: GalleryApiClient;
  private readonly options: ExchangeRuntimeOptions;
  private readonly now: () => number;
  private readonly catalog: CatalogCache;
  private readonly searchEngine = new SearchEngine();
  private readonly details = new Map<string, { asset: ExchangeAsset; loadedAt: number }>();
  private readonly pendingDetails = new Map<string, Promise<ExchangeAsset>>();
  private tags: { items: ExchangeTag[]; loadedAt: number } | undefined;
  private pendingTags: Promise<ExchangeTag[]> | undefined;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;

  constructor({
    client,
    options,
    now = Date.now,
  }: {
    client: GalleryApiClient;
    options: ExchangeRuntimeOptions;
    now?: () => number;
  }) {
    this.client = client;
    this.options = options;
    this.now = now;
    this.catalog = new CatalogCache(client, options, now);
  }

  /** Warms the catalog so the first tool call does not pay for the full load. */
  start(): void {
    if (this.refreshTimer) return;
    // Refresh failures are already recorded as missing/stale catalog metadata.
    const reload = (): void => void this.catalog.reload().catch(() => undefined);
    reload();
    this.refreshTimer = setInterval(reload, this.options.catalogTtlMs);
    this.refreshTimer.unref?.();
  }

  stop(): void {
    clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
  }

  async search(input: SearchInput): Promise<Result<ToolResponse<SearchData>, McpToolError>> {
    return this.execute(async () => {
      const parsed = searchSchema.safeParse(input);
      if (!parsed.success) throw new ExchangeInputError('Invalid Exchange search parameters.');
      // Validate query semantics before triggering any remote catalog reads.
      this.searchEngine.search([], parsed.data, this.options.maxSearchResults);
      const snapshot = await this.snapshot();
      return {
        data: this.searchEngine.search(snapshot.assets, parsed.data, this.options.maxSearchResults),
        meta: this.meta(snapshot),
      };
    });
  }

  async getAsset(input: {
    productId: number;
  }): Promise<Result<ToolResponse<ExchangeAsset>, McpToolError>> {
    return this.execute(async () => {
      if (!productIdSchema.safeParse(input.productId).success)
        throw new ExchangeInputError('A positive integer productId is required.');
      const snapshot = await this.snapshot();
      const data = await this.detail(input.productId, snapshot);
      return { data, meta: this.meta(snapshot) };
    });
  }

  async compare(input: {
    productIds: number[];
  }): Promise<Result<ToolResponse<CompareData>, McpToolError>> {
    return this.execute(async () => {
      if (!comparisonSchema.safeParse(input.productIds).success)
        throw new ExchangeInputError('Compare requires two to four unique positive product IDs.');
      const snapshot = await this.snapshot();
      // IDs are validated before fanout; Promise.all preserves the caller's order.
      input.productIds.forEach((id) => this.requireMember(id, snapshot));
      const assets = await Promise.all(input.productIds.map((id) => this.detail(id, snapshot)));
      const dimensions = assets.map((asset) => ({
        productId: asset.id,
        type: asset.type,
        publisher: asset.publisher.name,
        tags: asset.tags.map((tag) => tag.canonicalName),
        minimumTableauVersion: asset.minimumTableauVersion ?? null,
        downloads: asset.downloads ?? null,
        supportUrl: asset.supportUrl ?? null,
        communityContribution: asset.communityContribution,
      }));
      return { data: { assets, dimensions }, meta: this.meta(snapshot) };
    });
  }

  async download(input: {
    productId: number;
  }): Promise<Result<ToolResponse<DownloadData>, McpToolError>> {
    return this.execute(async () => {
      if (!productIdSchema.safeParse(input.productId).success)
        throw new ExchangeInputError('A positive integer productId is required.');
      const snapshot = await this.snapshot();
      // The detail read also carries the listing's installation instructions, where Gallery has them.
      const asset = await this.detail(input.productId, snapshot);
      const format = packageFormats[asset.type];
      const installationInstructions =
        asset.details?.kind === 'connector' ? asset.details.installationInstructions : undefined;
      let file: Buffer;
      try {
        file = Buffer.from(
          await this.client.downloadProduct({ productId: asset.id, maxBytes: MAX_DOWNLOAD_BYTES }),
        );
      } catch (error) {
        if (error instanceof GalleryApiClientError && error.kind === 'not-found')
          throw new ExchangeDownloadError('This listing has no downloadable file on the Exchange.');
        if (error instanceof GalleryApiClientError && error.kind === 'too-large')
          throw new ExchangeDownloadError(
            `The file exceeds the ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB download size limit.`,
          );
        throw error;
      }
      if (!format.matches(file))
        throw new ExchangeDownloadError(
          `The Exchange returned a file that is not a .${format.extension} package; nothing was saved.`,
        );
      const fileName = `${fileStem(asset)}.${format.extension}`;
      const directory = join(this.options.downloadDir, String(asset.id));
      const path = join(directory, fileName);
      await mkdir(directory, { recursive: true });
      // Write beside the target and rename so an interrupted write never leaves a partial package.
      const partial = `${path}.part`;
      try {
        await writeFile(partial, file);
        await rename(partial, path);
      } catch (error) {
        await rm(partial, { force: true });
        throw error;
      }
      return {
        data: {
          productId: asset.id,
          type: asset.type,
          name: asset.name,
          fileName,
          path,
          bytes: file.length,
          sha256: createHash('sha256').update(file).digest('hex'),
          listingUrl: asset.listingUrl,
          nextStep: installationInstructions
            ? "Follow the publisher's installation instructions below. If they don't say where the .taco file goes, it belongs in My Tableau Repository/Connectors."
            : format.nextStep,
          ...(installationInstructions ? { installationInstructions } : {}),
        },
        meta: this.meta(snapshot, [
          'The file was saved but not opened, extracted or installed. It is third-party content; review it and the listing before installing.',
        ]),
      };
    });
  }

  async listCategories(input: {
    assetType?: AssetType;
    tagType?: string;
  }): Promise<Result<ToolResponse<FacetData>, McpToolError>> {
    return this.execute(async () => {
      if (
        (input.assetType !== undefined &&
          !galleryAssetTypeSchema.safeParse(input.assetType).success) ||
        (input.tagType !== undefined &&
          (typeof input.tagType !== 'string' ||
            !input.tagType.trim() ||
            input.tagType.length > 100))
      )
        throw new ExchangeInputError('Invalid Exchange category filters.');
      const snapshot = await this.snapshot();
      let supplemental: ExchangeTag[] = [];
      const warnings: string[] = [];
      try {
        supplemental = await this.loadTags();
      } catch {
        warnings.push('Supplemental tag labels are unavailable; using catalog tags.');
      }
      const labels = new Map(supplemental.map((tag) => [tag.id, tag]));
      const counts = new Map<number, ExchangeTag & { assetCount: number }>();
      for (const asset of snapshot.assets) {
        if (input.assetType && asset.type !== input.assetType) continue;
        for (const tag of asset.tags) {
          const labeled = labels.get(tag.id) ?? tag;
          if (input.tagType && labeled.type !== input.tagType) continue;
          const previous = counts.get(tag.id);
          counts.set(tag.id, { ...labeled, assetCount: (previous?.assetCount ?? 0) + 1 });
        }
      }
      const grouped = new Map<string, Array<ExchangeTag & { assetCount: number }>>();
      for (const tag of counts.values())
        grouped.set(tag.type, [...(grouped.get(tag.type) ?? []), tag]);
      const compare = (left: string, right: string): number =>
        left < right ? -1 : left > right ? 1 : 0;
      const groups = [...grouped.entries()]
        .sort(([left], [right]) => compare(left, right))
        .map(([type, tags]) => ({
          type,
          tags: tags.sort(
            (left, right) => compare(left.canonicalName, right.canonicalName) || left.id - right.id,
          ),
        }));
      warnings.push(
        'Only tags used by published catalog assets are included; unused configured categories are omitted.',
      );
      return {
        data: { scope: 'published-used' as const, groups },
        meta: this.meta(snapshot, warnings),
      };
    });
  }

  private async snapshot(): Promise<CatalogSnapshot> {
    const snapshot = await this.catalog.load();
    if (!snapshot.available) throw new ExchangeUnavailableError();
    return snapshot;
  }

  private requireMember(id: number, snapshot: CatalogSnapshot): ExchangeAsset {
    const asset = snapshot.assets.find((candidate) => candidate.id === id);
    if (asset) return asset;
    if ([...snapshot.types.values()].some((type) => type.partial))
      throw new ExchangeUnavailableError();
    throw new ExchangeNotFoundError();
  }

  private async detail(id: number, snapshot: CatalogSnapshot): Promise<ExchangeAsset> {
    const member = this.requireMember(id, snapshot);
    const key = `${this.options.locale}:${id}`;
    const cached = this.details.get(key);
    if (cached && this.now() - cached.loadedAt < this.options.catalogTtlMs) return cached.asset;
    const pending = this.pendingDetails.get(key);
    if (pending) return pending;
    const request = (async () => {
      try {
        const raw = await this.client.getProduct({ productId: id, locale: this.options.locale });
        const asset = normalizeProduct(raw, this.options.webBaseUrl, 'detail');
        if (
          asset.type !== member.type ||
          (asset.publishDate && new Date(asset.publishDate).getTime() > this.now())
        ) {
          this.catalog.evict(id);
          this.details.delete(key);
          throw new ExchangeNotFoundError();
        }
        this.details.delete(key);
        this.details.set(key, { asset, loadedAt: this.now() });
        while (this.details.size > this.options.detailCacheMaxEntries) {
          const oldest = this.details.keys().next().value;
          if (oldest !== undefined) this.details.delete(oldest);
        }
        return asset;
      } catch (error) {
        if (error instanceof GalleryApiClientError && error.kind === 'not-found') {
          this.catalog.evict(id);
          this.details.delete(key);
          throw new ExchangeNotFoundError();
        }
        throw error;
      }
    })().finally(() => {
      this.pendingDetails.delete(key);
    });
    this.pendingDetails.set(key, request);
    return request;
  }

  private async loadTags(): Promise<ExchangeTag[]> {
    if (this.tags && this.now() - this.tags.loadedAt < this.options.catalogTtlMs)
      return this.tags.items;
    if (!this.pendingTags)
      this.pendingTags = this.client
        .listTags({ locale: this.options.locale })
        .then((raw) => {
          const items = raw.flatMap((tag) => {
            const normalized = normalizeTag(tag);
            return normalized ? [normalized] : [];
          });
          this.tags = { items, loadedAt: this.now() };
          return items;
        })
        .finally(() => {
          this.pendingTags = undefined;
        });
    return this.pendingTags;
  }

  private meta(snapshot: CatalogSnapshot, warnings: string[] = []): CatalogMeta {
    const state = (type: AssetType): CatalogTypeState | undefined => snapshot.types.get(type);
    const age =
      snapshot.loadedAt === null
        ? null
        : Math.max(0, Math.floor((this.now() - snapshot.loadedAt) / 1_000));
    return {
      generatedAt: new Date(this.now()).toISOString(),
      catalogLoadedAt:
        snapshot.loadedAt === null ? null : new Date(snapshot.loadedAt).toISOString(),
      catalogAssetCount: snapshot.assets.length,
      partialProductTypes: exchangeAssetTypes.filter((type) => state(type)?.partial),
      missingProductTypes: exchangeAssetTypes.filter((type) => state(type)?.missing),
      staleProductTypes: exchangeAssetTypes.filter((type) => state(type)?.stale),
      source: this.options.source,
      cacheAgeSeconds: age,
      stale: [...snapshot.types.values()].some((type) => type.stale),
      warnings: [...new Set([...snapshot.warnings, ...warnings])],
    };
  }

  private async execute<T>(
    callback: () => Promise<ToolResponse<T>>,
  ): Promise<Result<ToolResponse<T>, McpToolError>> {
    try {
      return new Ok(await callback());
    } catch (error) {
      return new Err(error instanceof McpToolError ? error : new ExchangeUnavailableError());
    }
  }
}
