import { log } from '../../../logging/logger.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { ExpiringMap } from '../../../utils/expiringMap.js';
import { milliseconds } from '../../../utils/milliseconds.js';
import { paginate } from '../../../utils/paginate.js';
import { parseNumber } from '../../../utils/parseNumber.js';

const RESOLVER_LOGGER = 'admin-insights-resolver';

// Bounded entry cap for the dataset-LUID cache. A plain constant (not an env var) keeps the doc
// surface tight; the cache is keyed by `${siteId}:${datasetName}` and each site contributes at most
// a handful of Admin Insights dataset names, so 256 comfortably covers many concurrent sites while
// still bounding memory. Eviction is oldest-inserted (see ExpiringMap.maxSize).
const ADMIN_INSIGHTS_CACHE_MAX_ENTRIES = 256;

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
// keyed by `${siteId}:${datasetName}` -> dataset LUID.
//
// W-22551424 hardening: the cache is now size-capped (ADMIN_INSIGHTS_CACHE_MAX_ENTRIES, oldest-
// inserted eviction) and emits debug telemetry on hit / miss / resolve. Invalidation is
// intentionally TTL + siteId-keying only — an explicit refresh-on-auth-lifecycle hook does not
// exist today and would bleed outside admin-insights, so it is deferred to a future ticket.
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
      maxSize: ADMIN_INSIGHTS_CACHE_MAX_ENTRIES,
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
      log({
        message: `${RESOLVER_LOGGER}: cache hit for "${datasetName}"`,
        level: 'debug',
        logger: RESOLVER_LOGGER,
        data: { datasetName, cacheSize: resolverCache.size },
      });
      return cached;
    }

    log({
      message: `${RESOLVER_LOGGER}: cache miss for "${datasetName}", resolving via REST`,
      level: 'debug',
      logger: RESOLVER_LOGGER,
      data: { datasetName, cacheSize: resolverCache.size },
    });

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

    log({
      message: `${RESOLVER_LOGGER}: resolved ${datasources.length} datasets for site`,
      level: 'debug',
      logger: RESOLVER_LOGGER,
      data: { resolveCount: datasources.length, cacheSize: resolverCache.size },
    });

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
