import { GalleryApiClient } from '../gallery/GalleryApiClient.js';
import { normalizeProduct } from '../gallery/ProductNormalizer.js';
import { AssetType, ExchangeAsset, ExchangeRuntimeOptions } from '../types.js';
import { exchangeAssetTypes } from './SearchEngine.js';

export interface CatalogTypeState {
  assets: ExchangeAsset[];
  loadedAt: number | null;
  partial: boolean;
  missing: boolean;
  stale: boolean;
  warnings: string[];
}

export interface CatalogSnapshot {
  types: Map<AssetType, CatalogTypeState>;
  assets: ExchangeAsset[];
  available: boolean;
  loadedAt: number | null;
  warnings: string[];
}

interface FetchTypeResult {
  assets: ExchangeAsset[];
  partial: boolean;
  warnings: string[];
}

/** A bounded, in-memory catalog snapshot with one in-flight refresh per locale. */
export class CatalogCache {
  private readonly typeStates = new Map<AssetType, CatalogTypeState>();
  private refreshPromise: Promise<CatalogSnapshot> | undefined;
  private lastAttemptAt: number | undefined;

  constructor(
    private readonly client: GalleryApiClient,
    private readonly options: ExchangeRuntimeOptions,
    private readonly now: () => number = Date.now,
  ) {}

  async load(): Promise<CatalogSnapshot> {
    if (this.isFresh()) return this.snapshot();
    if (
      !this.refreshPromise &&
      this.lastAttemptAt !== undefined &&
      this.now() - this.lastAttemptAt < Math.min(this.options.catalogTtlMs, 5_000)
    )
      return this.snapshot();
    return await this.reload();
  }

  /** Refreshes regardless of freshness, sharing any refresh already in flight. */
  async reload(): Promise<CatalogSnapshot> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.refresh().finally(() => {
        this.refreshPromise = undefined;
      });
    }
    return await this.refreshPromise;
  }

  private isFresh(): boolean {
    if (this.typeStates.size !== exchangeAssetTypes.length) return false;
    return exchangeAssetTypes.every((type) => {
      const state = this.typeStates.get(type);
      return (
        state !== undefined &&
        state.loadedAt !== null &&
        this.now() - state.loadedAt < this.options.catalogTtlMs
      );
    });
  }

  private async refresh(): Promise<CatalogSnapshot> {
    this.lastAttemptAt = this.now();
    let remainingCapacity = this.options.maxCatalogAssets;
    for (const type of exchangeAssetTypes) {
      const previous = this.typeStates.get(type);
      try {
        const next = await this.fetchType(type, Math.max(remainingCapacity, 0));
        remainingCapacity -= next.assets.length;
        this.typeStates.set(type, {
          assets: next.assets,
          loadedAt: this.now(),
          partial: next.partial,
          missing: false,
          stale: false,
          warnings: next.warnings,
        });
      } catch {
        if (previous && previous.loadedAt !== null) {
          const retained = previous.assets.slice(0, Math.max(remainingCapacity, 0));
          remainingCapacity -= retained.length;
          this.typeStates.set(type, {
            ...previous,
            assets: retained,
            partial: true,
            stale: true,
            warnings: [`Using stale ${type} catalog data after refresh failed.`],
          });
        } else {
          this.typeStates.set(type, {
            assets: [],
            loadedAt: null,
            partial: true,
            missing: true,
            stale: false,
            warnings: [`${type} catalog data is currently unavailable.`],
          });
        }
      }
    }
    return this.snapshot();
  }

  private async fetchType(type: AssetType, capacity: number): Promise<FetchTypeResult> {
    const assetsById = new Map<number, ExchangeAsset>();
    const warnings: string[] = [];
    let partial = false;
    for (let page = 1; page <= this.options.maxPagesPerType; page += 1) {
      if (assetsById.size >= capacity) {
        partial = true;
        warnings.push(`${type} catalog reached the configured asset limit.`);
        break;
      }
      const [official, community] = await Promise.all([
        this.client.listProducts({
          type,
          locale: this.options.locale,
          page,
          perPage: this.options.pageSize,
          community: false,
        }),
        this.client.listProducts({
          type,
          locale: this.options.locale,
          page,
          perPage: this.options.pageSize,
          community: true,
        }),
      ]);
      const rawProducts = [...official.products, ...community.products];
      const before = assetsById.size;
      for (const product of rawProducts) {
        if (product.product_type !== type) throw new Error('Unexpected catalog product type');
        const asset = normalizeProduct(product, this.options.webBaseUrl, 'summary');
        if (assetsById.size < capacity || assetsById.has(asset.id)) assetsById.set(asset.id, asset);
        else if (!partial) {
          partial = true;
          warnings.push(`${type} catalog reached the configured asset limit.`);
        }
      }
      const madeProgress = assetsById.size > before;
      const rawCardinality = rawProducts.length;
      if (rawCardinality > this.options.pageSize && !partial) {
        partial = true;
        warnings.push(`${type} catalog changed while pagination was in progress.`);
      }
      if (rawCardinality === 0) break; // a valid empty first page is a valid empty type
      if (!madeProgress) {
        partial = true;
        warnings.push(`${type} catalog pagination made no progress.`);
        break;
      }
      if (rawCardinality < this.options.pageSize) break;
      if (page === this.options.maxPagesPerType) {
        partial = true;
        warnings.push(`${type} catalog reached the configured page limit.`);
      }
    }
    return { assets: [...assetsById.values()], partial, warnings };
  }

  private snapshot(): CatalogSnapshot {
    const states = new Map(this.typeStates);
    const assetsById = new Map<number, ExchangeAsset>();
    for (const state of states.values()) {
      for (const asset of state.assets) assetsById.set(asset.id, asset);
    }
    const stateValues = [...states.values()];
    const loadedTimes = stateValues.flatMap((state) =>
      state.loadedAt === null ? [] : [state.loadedAt],
    );
    return {
      types: states,
      assets: [...assetsById.values()],
      available: stateValues.some((state) => !state.missing),
      loadedAt: loadedTimes.length ? Math.min(...loadedTimes) : null,
      warnings: stateValues.flatMap((state) => state.warnings),
    };
  }

  evict(productId: number): void {
    for (const state of this.typeStates.values()) {
      state.assets = state.assets.filter((asset) => asset.id !== productId);
    }
  }
}
