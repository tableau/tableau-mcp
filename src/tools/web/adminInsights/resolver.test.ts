import { RestApi } from '../../../sdks/tableau/restApi.js';
import {
  ADMIN_INSIGHTS_DATASETS,
  AdminInsightsDatasetNotFoundError,
  adminInsightsResolver,
} from './resolver.js';

type TestDatasource = {
  id: string;
  name: string;
  contentUrl?: string;
  description?: string;
  createdAt?: string;
  isCertified?: boolean;
  project?: { id: string; name: string };
  owner?: { id: string };
};

describe('adminInsightsResolver', () => {
  beforeEach(() => {
    adminInsightsResolver.clearCache();
  });

  function makeRestApi({
    siteId,
    datasources,
    listSpy,
    projects = [],
    projectsSpy,
    users = {},
    usersSpy,
  }: {
    siteId: string;
    datasources: TestDatasource[];
    listSpy?: ReturnType<typeof vi.fn>;
    projects?: Array<{
      id: string;
      name: string;
      parentProjectId?: string;
      topLevelProject?: boolean;
      createdAt?: string;
    }>;
    projectsSpy?: ReturnType<typeof vi.fn>;
    users?: Record<string, { id: string; fullName?: string; email?: string } | 'reject'>;
    usersSpy?: ReturnType<typeof vi.fn>;
  }): RestApi {
    const normalized = datasources.map((ds) => ({
      project: { id: 'proj-default', name: 'Admin Insights' },
      ...ds,
    }));
    const list =
      listSpy ??
      vi.fn().mockResolvedValue({
        pagination: { pageNumber: 1, pageSize: 100, totalAvailable: normalized.length },
        datasources: normalized,
      });
    const queryProjects =
      projectsSpy ??
      vi.fn().mockResolvedValue({
        pagination: { pageNumber: 1, pageSize: 100, totalAvailable: projects.length },
        projects,
      });
    const queryUserOnSite =
      usersSpy ??
      vi.fn().mockImplementation(async ({ userId }: { userId: string }) => {
        const entry = users[userId];
        if (!entry || entry === 'reject') {
          throw new Error('404 not found');
        }
        return entry;
      });
    return {
      siteId,
      datasourcesMethods: { listDatasources: list },
      projectsMethods: { queryProjects },
      usersMethods: { queryUserOnSite },
    } as unknown as RestApi;
  }

  describe('single-candidate fast path', () => {
    it('resolves a known dataset name to its LUID with no project/user calls', async () => {
      const projectsSpy = vi.fn();
      const usersSpy = vi.fn();
      const restApi = makeRestApi({
        siteId: 'site-1',
        datasources: [
          { id: 'luid-tse', name: 'TS Events' },
          { id: 'luid-sc', name: 'Site Content' },
        ],
        projectsSpy,
        usersSpy,
      });

      const resolution = await adminInsightsResolver.resolveDatasetLuid({
        restApi,
        datasetName: ADMIN_INSIGHTS_DATASETS.TS_EVENTS,
      });

      expect(resolution.luid).toBe('luid-tse');
      expect(resolution.reason).toBe('single-candidate');
      expect(resolution.warnings).toHaveLength(0);
      expect(projectsSpy).not.toHaveBeenCalled();
      expect(usersSpy).not.toHaveBeenCalled();
    });

    it('resolves the TS Users dataset name to its LUID', async () => {
      const restApi = makeRestApi({
        siteId: 'site-tsusers',
        datasources: [
          { id: 'luid-tse', name: 'TS Events' },
          { id: 'luid-tsu', name: 'TS Users' },
          { id: 'luid-sc', name: 'Site Content' },
        ],
      });

      const resolution = await adminInsightsResolver.resolveDatasetLuid({
        restApi,
        datasetName: ADMIN_INSIGHTS_DATASETS.TS_USERS,
      });

      expect(resolution.luid).toBe('luid-tsu');
    });

    it('caches per-site so repeat lookups skip the REST call', async () => {
      const listSpy = vi.fn().mockResolvedValue({
        pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 1 },
        datasources: [{ id: 'luid-sc', name: 'Site Content', project: { id: 'p', name: 'x' } }],
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
      const second = await adminInsightsResolver.resolveDatasetLuid({
        restApi,
        datasetName: ADMIN_INSIGHTS_DATASETS.SITE_CONTENT,
      });

      expect(listSpy).toHaveBeenCalledTimes(1);
      expect(second.luid).toBe('luid-sc');
      expect(second.reason).toBe('cache');
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

  describe('cache no longer poisons', () => {
    it('caches only the resolved winning LUID, not every sibling name', async () => {
      const listSpy = vi.fn().mockResolvedValue({
        pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 2 },
        datasources: [
          { id: 'luid-sc', name: 'Site Content', project: { id: 'p', name: 'Admin Insights' } },
          { id: 'luid-tse', name: 'TS Events', project: { id: 'p', name: 'Admin Insights' } },
        ],
      });
      const restApi = makeRestApi({
        siteId: 'site-poison',
        datasources: [
          { id: 'luid-sc', name: 'Site Content' },
          { id: 'luid-tse', name: 'TS Events' },
        ],
        listSpy,
      });

      // Resolve Site Content, then TS Events. If the resolver still bulk-cached every name, the
      // TS Events lookup would hit the cache and skip the second REST call. It must NOT.
      await adminInsightsResolver.resolveDatasetLuid({
        restApi,
        datasetName: ADMIN_INSIGHTS_DATASETS.SITE_CONTENT,
      });
      const tse = await adminInsightsResolver.resolveDatasetLuid({
        restApi,
        datasetName: ADMIN_INSIGHTS_DATASETS.TS_EVENTS,
      });

      expect(tse.luid).toBe('luid-tse');
      expect(listSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('project disambiguation (S1)', () => {
    it('narrows to the top-level Admin Insights project when names collide', async () => {
      const restApi = makeRestApi({
        siteId: 'site-proj',
        datasources: [
          {
            id: 'luid-canonical',
            name: 'Site Content',
            project: { id: 'proj-top', name: 'Admin Insights' },
          },
          {
            id: 'luid-clone',
            name: 'Site Content',
            project: { id: 'proj-nested', name: 'Admin Insights' },
          },
        ],
        projects: [
          {
            id: 'proj-top',
            name: 'Admin Insights',
            topLevelProject: true,
            createdAt: '2020-01-16',
          },
          {
            id: 'proj-nested',
            name: 'Admin Insights',
            parentProjectId: 'proj-top',
            createdAt: '2022-09-23',
          },
        ],
      });

      const resolution = await adminInsightsResolver.resolveDatasetLuid({
        restApi,
        datasetName: ADMIN_INSIGHTS_DATASETS.SITE_CONTENT,
      });

      expect(resolution.luid).toBe('luid-canonical');
      expect(resolution.reason).toBe('disambiguated');
      expect(resolution.warnings).toHaveLength(1);
      expect(resolution.warnings[0].chosenLuid).toBe('luid-canonical');
      // The nested-project clone is pruned by project narrowing, leaving the canonical survivor.
      expect(resolution.warnings[0].candidates.map((c) => c.luid)).toEqual(['luid-canonical']);
    });
  });

  describe('free-signal scoring (S2/S5/S7)', () => {
    it('picks the certified, clean-contentUrl candidate without any owner lookup', async () => {
      const usersSpy = vi.fn();
      const restApi = makeRestApi({
        siteId: 'site-score',
        datasources: [
          {
            id: 'luid-clone',
            name: 'Site Content',
            contentUrl: 'SiteContent_16639515632470',
            isCertified: false,
            project: { id: 'proj-top', name: 'Admin Insights' },
            owner: { id: 'owner-clone' },
          },
          {
            id: 'luid-canonical',
            name: 'Site Content',
            contentUrl: 'SiteContent',
            isCertified: true,
            description: 'Site Content Overview',
            project: { id: 'proj-top', name: 'Admin Insights' },
            owner: { id: 'owner-system' },
          },
        ],
        projects: [{ id: 'proj-top', name: 'Admin Insights', topLevelProject: true }],
        usersSpy,
      });

      const resolution = await adminInsightsResolver.resolveDatasetLuid({
        restApi,
        datasetName: ADMIN_INSIGHTS_DATASETS.SITE_CONTENT,
      });

      expect(resolution.luid).toBe('luid-canonical');
      expect(usersSpy).not.toHaveBeenCalled();
    });

    it('repeats the collision resolution for TS Events / TS Users / Job Performance', async () => {
      for (const [datasetName, slug] of [
        [ADMIN_INSIGHTS_DATASETS.TS_EVENTS, 'TSEvents'],
        [ADMIN_INSIGHTS_DATASETS.TS_USERS, 'TSUsers'],
        [ADMIN_INSIGHTS_DATASETS.JOB_PERFORMANCE, 'JobPerformance'],
      ] as const) {
        adminInsightsResolver.clearCache();
        const restApi = makeRestApi({
          siteId: `site-${slug}`,
          datasources: [
            {
              id: 'luid-clone',
              name: datasetName,
              contentUrl: `${slug}_16639515632470`,
              isCertified: false,
              project: { id: 'proj-top', name: 'Admin Insights' },
            },
            {
              id: 'luid-canonical',
              name: datasetName,
              contentUrl: slug,
              isCertified: true,
              project: { id: 'proj-top', name: 'Admin Insights' },
            },
          ],
          projects: [{ id: 'proj-top', name: 'Admin Insights', topLevelProject: true }],
        });

        const resolution = await adminInsightsResolver.resolveDatasetLuid({
          restApi,
          datasetName,
        });
        expect(resolution.luid).toBe('luid-canonical');
      }
    });
  });

  describe('residual tie → owner check (S3)', () => {
    it('prefers the non-enumerable (system-account) owner on a score tie', async () => {
      // Both candidates score identically on free signals (both certified, both clean-ish, neither
      // matches the canonical slug), forcing the owner lookup.
      const usersSpy = vi.fn().mockImplementation(async ({ userId }: { userId: string }) => {
        if (userId === 'owner-system') {
          throw new Error('404 not found'); // non-enumerable system account
        }
        return { id: userId, fullName: 'Regular User', email: 'user@example.com' };
      });
      const restApi = makeRestApi({
        siteId: 'site-tie',
        datasources: [
          {
            id: 'luid-user',
            name: 'Site Content',
            contentUrl: 'SiteContentA',
            isCertified: true,
            project: { id: 'proj-top', name: 'Admin Insights' },
            owner: { id: 'owner-user' },
          },
          {
            id: 'luid-system',
            name: 'Site Content',
            contentUrl: 'SiteContentB',
            isCertified: true,
            project: { id: 'proj-top', name: 'Admin Insights' },
            owner: { id: 'owner-system' },
          },
        ],
        projects: [{ id: 'proj-top', name: 'Admin Insights', topLevelProject: true }],
        usersSpy,
      });

      const resolution = await adminInsightsResolver.resolveDatasetLuid({
        restApi,
        datasetName: ADMIN_INSIGHTS_DATASETS.SITE_CONTENT,
      });

      expect(resolution.luid).toBe('luid-system');
      expect(usersSpy).toHaveBeenCalled();
    });

    it('prefers owner fullName "Tableau System Account" as the primary owner signal', async () => {
      const usersSpy = vi.fn().mockImplementation(async ({ userId }: { userId: string }) => {
        if (userId === 'owner-system') {
          return { id: userId, fullName: 'Tableau System Account' };
        }
        return { id: userId, fullName: 'Regular User', email: 'user@example.com' };
      });
      const restApi = makeRestApi({
        siteId: 'site-fullname',
        datasources: [
          {
            id: 'luid-user',
            name: 'Site Content',
            contentUrl: 'SiteContentA',
            isCertified: true,
            project: { id: 'proj-top', name: 'Admin Insights' },
            owner: { id: 'owner-user' },
          },
          {
            id: 'luid-system',
            name: 'Site Content',
            contentUrl: 'SiteContentB',
            isCertified: true,
            project: { id: 'proj-top', name: 'Admin Insights' },
            owner: { id: 'owner-system' },
          },
        ],
        projects: [{ id: 'proj-top', name: 'Admin Insights', topLevelProject: true }],
        usersSpy,
      });

      const resolution = await adminInsightsResolver.resolveDatasetLuid({
        restApi,
        datasetName: ADMIN_INSIGHTS_DATASETS.SITE_CONTENT,
      });

      expect(resolution.luid).toBe('luid-system');
    });

    it('treats the service-account email as a weak hint only (never overrides certification)', async () => {
      // The uncertified clone owner matches the service-account email regex, but certification on
      // the canonical candidate must still win — the email is only worth a small bump.
      const usersSpy = vi.fn().mockResolvedValue({
        id: 'owner',
        fullName: 'Someone',
        email: 'tol.admin.api.broker.service.userb@tableau.com',
      });
      const restApi = makeRestApi({
        siteId: 'site-email',
        datasources: [
          {
            id: 'luid-clone',
            name: 'Site Content',
            contentUrl: 'SiteContent_16639515632470',
            isCertified: false,
            project: { id: 'proj-top', name: 'Admin Insights' },
            owner: { id: 'owner-email' },
          },
          {
            id: 'luid-canonical',
            name: 'Site Content',
            contentUrl: 'SiteContent',
            isCertified: true,
            project: { id: 'proj-top', name: 'Admin Insights' },
            owner: { id: 'owner-regular' },
          },
        ],
        projects: [{ id: 'proj-top', name: 'Admin Insights', topLevelProject: true }],
        usersSpy,
      });

      const resolution = await adminInsightsResolver.resolveDatasetLuid({
        restApi,
        datasetName: ADMIN_INSIGHTS_DATASETS.SITE_CONTENT,
      });

      expect(resolution.luid).toBe('luid-canonical');
    });
  });

  describe('override map', () => {
    it('returns the pinned LUID with no list/project/user calls', async () => {
      const listSpy = vi.fn();
      const projectsSpy = vi.fn();
      const usersSpy = vi.fn();
      const restApi = makeRestApi({
        siteId: 'site-override',
        datasources: [],
        listSpy,
        projectsSpy,
        usersSpy,
      });

      const resolution = await adminInsightsResolver.resolveDatasetLuid({
        restApi,
        datasetName: ADMIN_INSIGHTS_DATASETS.SITE_CONTENT,
        overrideLuid: 'pinned-luid',
      });

      expect(resolution.luid).toBe('pinned-luid');
      expect(resolution.reason).toBe('override');
      expect(listSpy).not.toHaveBeenCalled();
      expect(projectsSpy).not.toHaveBeenCalled();
      expect(usersSpy).not.toHaveBeenCalled();
    });
  });

  describe('dead-LUID handling', () => {
    it('skips a negative-cached dead LUID and resolves the surviving candidate', async () => {
      const restApi = makeRestApi({
        siteId: 'site-dead',
        datasources: [
          {
            id: 'luid-dead',
            name: 'Site Content',
            contentUrl: 'SiteContent',
            isCertified: true,
            project: { id: 'proj-top', name: 'Admin Insights' },
          },
          {
            id: 'luid-alive',
            name: 'Site Content',
            contentUrl: 'SiteContentB',
            isCertified: true,
            project: { id: 'proj-top', name: 'Admin Insights' },
          },
        ],
        projects: [{ id: 'proj-top', name: 'Admin Insights', topLevelProject: true }],
        users: { x: 'reject' },
      });

      adminInsightsResolver.markDatasetLuidDead({
        siteId: 'site-dead',
        datasetName: ADMIN_INSIGHTS_DATASETS.SITE_CONTENT,
        luid: 'luid-dead',
      });

      const resolution = await adminInsightsResolver.resolveDatasetLuid({
        restApi,
        datasetName: ADMIN_INSIGHTS_DATASETS.SITE_CONTENT,
      });

      expect(resolution.luid).toBe('luid-alive');
    });
  });

  describe('feature flag off (legacy path)', () => {
    it('reverts to last-writer-wins but still avoids cache poisoning', async () => {
      const listSpy = vi.fn().mockResolvedValue({
        pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 2 },
        datasources: [
          { id: 'luid-first', name: 'Site Content', project: { id: 'p', name: 'Admin Insights' } },
          { id: 'luid-last', name: 'Site Content', project: { id: 'p', name: 'Admin Insights' } },
        ],
      });
      const restApi = makeRestApi({
        siteId: 'site-legacy',
        datasources: [
          { id: 'luid-first', name: 'Site Content' },
          { id: 'luid-last', name: 'Site Content' },
        ],
        listSpy,
      });

      const resolution = await adminInsightsResolver.resolveDatasetLuid({
        restApi,
        datasetName: ADMIN_INSIGHTS_DATASETS.SITE_CONTENT,
        robustResolverEnabled: false,
      });

      expect(resolution.luid).toBe('luid-last');
      expect(resolution.reason).toBe('legacy');
    });
  });
});
