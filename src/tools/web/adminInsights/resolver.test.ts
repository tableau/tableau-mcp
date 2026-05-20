import { RestApi } from '../../../sdks/tableau/restApi.js';
import {
  ADMIN_INSIGHTS_DATASETS,
  AdminInsightsDatasetNotFoundError,
  adminInsightsResolver,
} from './resolver.js';

describe('adminInsightsResolver', () => {
  beforeEach(() => {
    adminInsightsResolver.clearCache();
  });

  function makeRestApi({
    siteId,
    datasources,
    listSpy,
  }: {
    siteId: string;
    datasources: Array<{ id: string; name: string }>;
    listSpy?: ReturnType<typeof vi.fn>;
  }): RestApi {
    const list =
      listSpy ??
      vi.fn().mockResolvedValue({
        pagination: { pageNumber: 1, pageSize: 100, totalAvailable: datasources.length },
        datasources,
      });
    return {
      siteId,
      datasourcesMethods: {
        listDatasources: list,
      },
    } as unknown as RestApi;
  }

  it('resolves a known dataset name to its LUID', async () => {
    const restApi = makeRestApi({
      siteId: 'site-1',
      datasources: [
        { id: 'luid-tse', name: 'TS Events' },
        { id: 'luid-sc', name: 'Site Content' },
      ],
    });

    const luid = await adminInsightsResolver.resolveDatasetLuid({
      restApi,
      datasetName: ADMIN_INSIGHTS_DATASETS.TS_EVENTS,
    });

    expect(luid).toBe('luid-tse');
  });

  it('caches per-site so repeat lookups skip the REST call', async () => {
    const listSpy = vi.fn().mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 1 },
      datasources: [{ id: 'luid-sc', name: 'Site Content' }],
    });
    const restApi = makeRestApi({
      siteId: 'site-cache',
      datasources: [{ id: 'luid-sc', name: 'Site Content' }],
      listSpy,
    });

    await adminInsightsResolver.resolveDatasetLuid({
      restApi,
      datasetName: ADMIN_INSIGHTS_DATASETS.SITE_CONTENT,
    });
    await adminInsightsResolver.resolveDatasetLuid({
      restApi,
      datasetName: ADMIN_INSIGHTS_DATASETS.SITE_CONTENT,
    });

    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it('throws AdminInsightsDatasetNotFoundError when the dataset is missing', async () => {
    const restApi = makeRestApi({
      siteId: 'site-empty',
      datasources: [{ id: 'luid-other', name: 'Some Other Dataset' }],
    });

    await expect(
      adminInsightsResolver.resolveDatasetLuid({
        restApi,
        datasetName: ADMIN_INSIGHTS_DATASETS.TS_EVENTS,
      }),
    ).rejects.toBeInstanceOf(AdminInsightsDatasetNotFoundError);
  });
});
