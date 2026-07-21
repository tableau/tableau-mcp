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

  it('evicts the oldest cache entry once the bounded max-entries cap is exceeded', async () => {
    // The resolver caches one entry per returned datasource (`${siteId}:${ds.name}`), so a single
    // resolve that returns more than the cap (256) fills and overflows the cache in one pass. The
    // target ("TS Events") is listed FIRST, so it is the oldest inserted and the first evicted once
    // the 257th entry lands. A subsequent lookup must therefore miss and re-issue the REST call.
    const CAP = 256;
    const datasources = [
      { id: 'luid-tse', name: 'TS Events' },
      ...Array.from({ length: CAP }, (_, i) => ({ id: `luid-filler-${i}`, name: `Filler ${i}` })),
    ];
    const listSpy = vi.fn().mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: datasources.length },
      datasources,
    });
    const restApi = makeRestApi({ siteId: 'site-evict', datasources, listSpy });

    const first = await adminInsightsResolver.resolveDatasetLuid({
      restApi,
      datasetName: ADMIN_INSIGHTS_DATASETS.TS_EVENTS,
    });
    expect(first).toBe('luid-tse');
    expect(listSpy).toHaveBeenCalledTimes(1);

    // "TS Events" was evicted (oldest inserted), so the second lookup misses and re-resolves —
    // still returning the correct LUID (no behavior regression).
    const second = await adminInsightsResolver.resolveDatasetLuid({
      restApi,
      datasetName: ADMIN_INSIGHTS_DATASETS.TS_EVENTS,
    });
    expect(second).toBe('luid-tse');
    expect(listSpy).toHaveBeenCalledTimes(2);
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
