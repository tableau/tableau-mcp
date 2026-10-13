export type AssetType = 'skill' | 'extension' | 'viz' | 'connector' | 'accelerator';

export interface ExchangeTag {
  id: number;
  name: string;
  canonicalName: string;
  type: string;
  applicableProductType: AssetType | null;
}

export type ExchangeDetails =
  | {
      kind: 'connector';
      versionNumber?: string;
      dataSourceClass?: string;
      installationInstructions?: string;
    }
  | {
      kind: 'accelerator';
      connectionTypeDisplayName?: string;
    }
  | {
      kind: 'extension' | 'viz';
      extensionUrl?: string;
      publicExamples?: Array<{ name: string; url: string }>;
    };

export interface ExchangeAsset {
  id: number;
  type: AssetType;
  name: string;
  shortDescription: string;
  detailedDescription?: string;
  descriptionTruncated?: boolean;
  publisher: { id: number | null; name: string };
  tags: ExchangeTag[];
  minimumTableauVersion?: string;
  downloads?: number;
  publishDate?: string;
  iconUrl?: string;
  pictureUrls?: string[];
  supportUrl?: string;
  privacyPolicyUrl?: string;
  listingUrl: string;
  communityContribution: boolean;
  technicalMetadataStatus: 'unavailable' | 'available';
  details?: ExchangeDetails;
}

export interface ExchangeRuntimeOptions {
  webBaseUrl: URL;
  locale: string;
  catalogTtlMs: number;
  timeoutMs: number;
  pageSize: number;
  maxSearchResults: number;
  maxPagesPerType: number;
  maxCatalogAssets: number;
  detailCacheMaxEntries: number;
  source: 'gallery-api' | 'declared-fixture';
}

export interface SearchInput {
  query: string;
  assetTypes?: AssetType[];
  tags?: string[];
  publisher?: string;
  tableauVersion?: string;
  communityContent?: 'include' | 'exclude' | 'only';
  limit?: number;
}

export interface AssetSearchResult {
  asset: ExchangeAsset;
  score: number;
  reasons: string[];
  matchedFields: Array<'name' | 'description' | 'tag' | 'publisher' | 'type'>;
}

export interface SearchData {
  results: AssetSearchResult[];
  totalMatches: number;
}

export interface CompareData {
  assets: ExchangeAsset[];
  dimensions: Array<{
    productId: number;
    type: AssetType;
    publisher: string;
    tags: string[];
    minimumTableauVersion: string | null;
    downloads: number | null;
    supportUrl: string | null;
    communityContribution: boolean;
  }>;
}

export interface FacetData {
  scope: 'published-used';
  groups: Array<{ type: string; tags: Array<ExchangeTag & { assetCount: number }> }>;
}

export interface CatalogMeta {
  generatedAt: string;
  catalogLoadedAt: string | null;
  catalogAssetCount: number;
  partialProductTypes: AssetType[];
  missingProductTypes: AssetType[];
  staleProductTypes: AssetType[];
  source: 'gallery-api' | 'declared-fixture';
  cacheAgeSeconds: number | null;
  stale: boolean;
  warnings: string[];
}

export interface ToolResponse<T> {
  data: T;
  meta: CatalogMeta;
}
