import { RestApi } from '../../../sdks/tableau/restApi.js';
import { paginate } from '../../../utils/paginate.js';

export const ADMIN_INSIGHTS_PROJECT_NAME = 'Admin Insights';

export const ADMIN_INSIGHTS_DATASETS = {
  TS_EVENTS: 'TS Events',
  SITE_CONTENT: 'Site Content',
} as const;

export type AdminInsightsDataset =
  (typeof ADMIN_INSIGHTS_DATASETS)[keyof typeof ADMIN_INSIGHTS_DATASETS];

// Mirrors the cache pattern in `adminGate.ts`: TTL-bounded entries keyed by a flat string.
// Full optimization (size limits, eviction policy, telemetry) tracked in W-22551424.
const cache: Map<string, { luid: string; expiresAt: number }> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

export class AdminInsightsDatasetNotFoundError extends Error {
  constructor(datasetName: string) {
    super(
      `Admin Insights dataset "${datasetName}" not found in the "${ADMIN_INSIGHTS_PROJECT_NAME}" project on this site. ` +
        'Confirm the caller is on a Tableau Cloud site with Admin Insights enabled and that the caller is a Site Administrator Creator.',
    );
    this.name = 'AdminInsightsDatasetNotFoundError';
  }
}

export const adminInsightsResolver = {
  async resolveDatasetLuid({
    restApi,
    datasetName,
  }: {
    restApi: RestApi;
    datasetName: AdminInsightsDataset;
  }): Promise<string> {
    const siteId = restApi.siteId;
    const cacheKey = `${siteId}:${datasetName}`;
    const now = Date.now();
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.luid;
    }

    const datasources = await paginate({
      pageConfig: { pageSize: 100 },
      getDataFn: async (pageConfig) => {
        const { pagination, datasources: data } = await restApi.datasourcesMethods.listDatasources({
          siteId,
          filter: `projectName:eq:${ADMIN_INSIGHTS_PROJECT_NAME}`,
          pageSize: pageConfig.pageSize,
          pageNumber: pageConfig.pageNumber,
        });
        return { pagination, data };
      },
    });

    const expiresAt = Date.now() + CACHE_TTL_MS;
    let resolvedLuid: string | undefined;
    for (const ds of datasources) {
      cache.set(`${siteId}:${ds.name}`, { luid: ds.id, expiresAt });
      if (ds.name === datasetName) {
        resolvedLuid = ds.id;
      }
    }

    if (!resolvedLuid) {
      throw new AdminInsightsDatasetNotFoundError(datasetName);
    }
    return resolvedLuid;
  },

  clearCache(): void {
    cache.clear();
  },
};
