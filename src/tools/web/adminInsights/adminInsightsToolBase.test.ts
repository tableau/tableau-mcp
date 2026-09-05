import { Err, Ok } from 'ts-results-es';

import {
  AdminInsightsUnavailableError,
  FeatureDisabledError,
} from '../../../errors/mcpToolError.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { executeAdminInsightsQuery, isHyperConnectionError } from './adminInsightsToolBase.js';
import { ADMIN_INSIGHTS_DATASETS, adminInsightsResolver } from './resolver.js';

const HYPER_ERROR = {
  type: 'api-error' as const,
  message:
    'Error in query: [Extract][SQLSTATE:08001] could not connect to the Hyper server ... 0x9EE5C2F0',
  httpStatus: 500,
  errorCode: undefined,
};

const NON_HYPER_ERROR = {
  type: 'api-error' as const,
  message: 'Some other backend failure',
  httpStatus: 400,
  errorCode: 'foo',
};

/**
 * A restApi mock whose Admin Insights project has TWO "Site Content" datasources: a canonical one
 * (clean contentUrl, certified) and a clone (timestamp-suffix contentUrl, uncertified). The resolver
 * ranks the canonical first, so the health-fallback path exercises canonical → clone.
 */
function makeRestApi(queryDatasource: ReturnType<typeof vi.fn>): RestApi {
  const datasources = [
    {
      id: 'luid-canonical',
      name: 'Site Content',
      contentUrl: 'SiteContent',
      isCertified: true,
      project: { id: 'proj-top', name: 'Admin Insights' },
    },
    {
      id: 'luid-clone',
      name: 'Site Content',
      contentUrl: 'SiteContent_16639515632470',
      isCertified: false,
      project: { id: 'proj-top', name: 'Admin Insights' },
    },
  ];
  return {
    siteId: 'site-hf',
    datasourcesMethods: {
      listDatasources: vi.fn().mockResolvedValue({
        pagination: { pageNumber: 1, pageSize: 100, totalAvailable: datasources.length },
        datasources,
      }),
    },
    projectsMethods: {
      queryProjects: vi.fn().mockResolvedValue({
        pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 1 },
        projects: [{ id: 'proj-top', name: 'Admin Insights', topLevelProject: true }],
      }),
    },
    usersMethods: { queryUserOnSite: vi.fn() },
    vizqlDataServiceMethods: { queryDatasource },
  } as unknown as RestApi;
}

describe('isHyperConnectionError', () => {
  it('matches the dead-extract signatures and nothing else', () => {
    expect(isHyperConnectionError('foo [SQLSTATE:08001] bar')).toBe(true);
    expect(isHyperConnectionError('Could not connect to the Hyper server')).toBe(true);
    expect(isHyperConnectionError('code 0x9EE5C2F0')).toBe(true);
    expect(isHyperConnectionError('permission denied')).toBe(false);
    expect(isHyperConnectionError('feature disabled')).toBe(false);
  });
});

describe('executeAdminInsightsQuery health fallback', () => {
  beforeEach(() => {
    adminInsightsResolver.clearCache();
  });

  it('falls back to the next candidate when the chosen one has a dead Hyper extract', async () => {
    const queryDatasource = vi
      .fn()
      .mockResolvedValueOnce(Err(HYPER_ERROR)) // luid-canonical is dead
      .mockResolvedValueOnce(Ok({ data: [{ ok: true }] })); // luid-clone works
    const restApi = makeRestApi(queryDatasource);

    const result = await executeAdminInsightsQuery({
      restApi,
      datasetName: ADMIN_INSIGHTS_DATASETS.SITE_CONTENT,
      query: { fields: [] },
    });

    expect(result.isOk()).toBe(true);
    const value = result.unwrap();
    expect(value.data).toEqual([{ ok: true }]);
    expect(queryDatasource).toHaveBeenCalledTimes(2);
    // First query hit the canonical LUID, the retry hit the clone.
    expect(queryDatasource.mock.calls[0][0].datasource.datasourceLuid).toBe('luid-canonical');
    expect(queryDatasource.mock.calls[1][0].datasource.datasourceLuid).toBe('luid-clone');
    const warningTypes = value.mcp?.warnings.map((w) => w.type) ?? [];
    expect(warningTypes).toContain('ADMIN_INSIGHTS_DATASOURCE_UNHEALTHY');
  });

  it('returns AdminInsightsUnavailableError when every candidate is dead', async () => {
    const queryDatasource = vi.fn().mockResolvedValue(Err(HYPER_ERROR));
    const restApi = makeRestApi(queryDatasource);

    const result = await executeAdminInsightsQuery({
      restApi,
      datasetName: ADMIN_INSIGHTS_DATASETS.SITE_CONTENT,
      query: { fields: [] },
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(AdminInsightsUnavailableError);
  });

  it('does NOT retry a feature-disabled error', async () => {
    const queryDatasource = vi.fn().mockResolvedValue(Err({ type: 'feature-disabled' }));
    const restApi = makeRestApi(queryDatasource);

    const result = await executeAdminInsightsQuery({
      restApi,
      datasetName: ADMIN_INSIGHTS_DATASETS.SITE_CONTENT,
      query: { fields: [] },
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(FeatureDisabledError);
    expect(queryDatasource).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a non-Hyper api-error (e.g. auth/permission failure)', async () => {
    const queryDatasource = vi.fn().mockResolvedValue(Err(NON_HYPER_ERROR));
    const restApi = makeRestApi(queryDatasource);

    const result = await executeAdminInsightsQuery({
      restApi,
      datasetName: ADMIN_INSIGHTS_DATASETS.SITE_CONTENT,
      query: { fields: [] },
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(AdminInsightsUnavailableError);
    expect(queryDatasource).toHaveBeenCalledTimes(1);
  });

  it('does NOT fall back when a pinned override LUID has a dead extract', async () => {
    const queryDatasource = vi.fn().mockResolvedValue(Err(HYPER_ERROR));
    const restApi = makeRestApi(queryDatasource);

    const result = await executeAdminInsightsQuery({
      restApi,
      datasetName: ADMIN_INSIGHTS_DATASETS.SITE_CONTENT,
      query: { fields: [] },
      datasetLuidOverride: 'pinned-luid',
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(AdminInsightsUnavailableError);
    expect(queryDatasource).toHaveBeenCalledTimes(1);
    expect(queryDatasource.mock.calls[0][0].datasource.datasourceLuid).toBe('pinned-luid');
  });
});
