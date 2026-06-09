import { RestApi } from '../../../sdks/tableau/restApi.js';
import { ExpiringMap } from '../../../utils/expiringMap.js';
import { milliseconds } from '../../../utils/milliseconds.js';
import { paginate } from '../../../utils/paginate.js';
import { parseNumber } from '../../../utils/parseNumber.js';

export const ADMIN_INSIGHTS_PROJECT_NAME = 'Admin Insights';

export const ADMIN_INSIGHTS_DATASETS = {
  TS_EVENTS: 'TS Events',
  SITE_CONTENT: 'Site Content',
  JOB_PERFORMANCE: 'Job Performance',
} as const;

export type AdminInsightsDataset =
  (typeof ADMIN_INSIGHTS_DATASETS)[keyof typeof ADMIN_INSIGHTS_DATASETS];

// Lazy-initialized cache to avoid module-level parseNumber call.
// Mirrors the pattern in `adminGate.ts`: ExpiringMap with env-var-configurable TTL,
// keyed by `${siteId}:${datasetName}` -> dataset LUID. Full optimization
// (size limits, eviction policy, telemetry) tracked in W-22551424.
let cache: ExpiringMap<string, string> | null = null;

function getCache(): ExpiringMap<string, string> {
  if (!cache) {
    // Reuses ADMIN_GATE_CACHE_TTL_MINUTES — single knob for all admin-tools caches.
    const ttlMinutes = parseNumber(process.env.ADMIN_GATE_CACHE_TTL_MINUTES, {
      defaultValue: 5,
      minValue: 1,
      maxValue: 60 * 24, // 24 hours
    });
    cache = new ExpiringMap<string, string>({
      defaultExpirationTimeMs: milliseconds.fromMinutes(ttlMinutes),
    });
  }
  return cache;
}

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
    const resolverCache = getCache();
    const cached = resolverCache.get(cacheKey);
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

    let resolvedLuid: string | undefined;
    for (const ds of datasources) {
      resolverCache.set(`${siteId}:${ds.name}`, ds.id);
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
    cache?.clear();
    cache = null;
  },
};
