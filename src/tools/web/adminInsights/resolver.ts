import { RestApi } from '../../../sdks/tableau/restApi.js';
import { paginate } from '../../../utils/paginate.js';

export const ADMIN_INSIGHTS_PROJECT_NAME = 'Admin Insights';

export const ADMIN_INSIGHTS_DATASETS = {
  TS_EVENTS: 'TS Events',
  SITE_CONTENT: 'Site Content',
} as const;

export type AdminInsightsDataset =
  (typeof ADMIN_INSIGHTS_DATASETS)[keyof typeof ADMIN_INSIGHTS_DATASETS];

type SiteCacheEntry = Map<string, string>;

const cache: Map<string, SiteCacheEntry> = new Map();

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
    const cached = cache.get(siteId)?.get(datasetName);
    if (cached) {
      return cached;
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

    const siteCache: SiteCacheEntry = cache.get(siteId) ?? new Map();
    for (const ds of datasources) {
      siteCache.set(ds.name, ds.id);
    }
    cache.set(siteId, siteCache);

    const luid = siteCache.get(datasetName);
    if (!luid) {
      throw new AdminInsightsDatasetNotFoundError(datasetName);
    }
    return luid;
  },

  clearCache(): void {
    cache.clear();
  },
};
