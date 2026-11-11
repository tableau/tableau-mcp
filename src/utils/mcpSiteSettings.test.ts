import { AxiosError } from 'axios';

import * as logger from '../logging/logger.js';
import { WebMcpServer } from '../server.web';
import { stubDefaultEnvVars } from '../testShared';
import { getConfigWithOverrides } from './mcpSiteSettings';

const mocks = vi.hoisted(() => ({
  mockGetMcpSiteSettings: vi.fn(),
}));

vi.mock('../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      mcpSettingsMethods: {
        getMcpSiteSettings: mocks.mockGetMcpSiteSettings,
      },
    }),
  ),
}));

describe('mcpSiteSettings', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should not override any settings when enableMcpSiteSettings is false', async () => {
    vi.stubEnv('ENABLE_MCP_SITE_SETTINGS', 'false');
    const config = await getConfigWithOverrides({
      restApiArgs: {
        server: new WebMcpServer(),
        tableauAuthInfo: undefined,
        disableLogging: true,
      },
      requestOverrides: undefined,
    });

    expect(config.includeTools).toEqual([]);
    expect(config.excludeTools).toEqual([]);
    expect(config.boundedContext).toEqual({
      projectIds: null,
      datasourceIds: null,
      workbookIds: null,
      viewIds: null,
      tags: null,
    });
    expect(config.getMaxResultLimit('query-datasource')).toEqual(null);
    expect(config.disableQueryDatasourceValidationRequests).toEqual(false);
    expect(config.disableMetadataApiRequests).toEqual(false);

    expect(mocks.mockGetMcpSiteSettings).not.toHaveBeenCalled();
  });

  it('should override settings when enableMcpSiteSettings is true', async () => {
    vi.stubEnv('ENABLE_MCP_SITE_SETTINGS', 'true');
    mocks.mockGetMcpSiteSettings.mockResolvedValue({
      settings: [
        { key: 'INCLUDE_TOOLS', value: 'list-views,list-datasources' },
        { key: 'INCLUDE_PROJECT_IDS', value: 'project1,project2' },
        { key: 'INCLUDE_DATASOURCE_IDS', value: 'datasource1,datasource2' },
        { key: 'INCLUDE_WORKBOOK_IDS', value: 'workbook1,workbook2' },
        { key: 'INCLUDE_VIEW_IDS', value: 'view1,view2' },
        { key: 'INCLUDE_TAGS', value: 'tag1,tag2' },
        { key: 'MAX_RESULT_LIMIT', value: '100' },
        { key: 'MAX_RESULT_LIMITS', value: 'query-datasource:100,list-datasources:20' },
        { key: 'DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS', value: 'true' },
        { key: 'DISABLE_METADATA_API_REQUESTS', value: 'true' },
      ],
    });

    let config = await getConfigWithOverrides({
      restApiArgs: {
        server: new WebMcpServer(),
        tableauAuthInfo: undefined,
        disableLogging: true,
      },
      requestOverrides: undefined,
    });

    expect(config.includeTools).toEqual(['list-views', 'list-datasources']);
    expect(config.excludeTools).toEqual([]);
    expect(config.boundedContext).toEqual({
      projectIds: new Set(['project1', 'project2']),
      datasourceIds: new Set(['datasource1', 'datasource2']),
      workbookIds: new Set(['workbook1', 'workbook2']),
      viewIds: new Set(['view1', 'view2']),
      tags: new Set(['tag1', 'tag2']),
    });
    expect(config.getMaxResultLimit('query-datasource')).toEqual(100);
    expect(config.getMaxResultLimit('list-datasources')).toEqual(20);
    expect(config.disableQueryDatasourceValidationRequests).toEqual(true);
    expect(config.disableMetadataApiRequests).toEqual(true);

    expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalledTimes(1);

    // Verify cache behavior
    config = await getConfigWithOverrides({
      restApiArgs: {
        server: new WebMcpServer(),
        tableauAuthInfo: undefined,
        disableLogging: true,
      },
      requestOverrides: undefined,
    });

    expect(config.includeTools).toEqual(['list-views', 'list-datasources']);
    expect(config.excludeTools).toEqual([]);
    expect(config.boundedContext).toEqual({
      projectIds: new Set(['project1', 'project2']),
      datasourceIds: new Set(['datasource1', 'datasource2']),
      workbookIds: new Set(['workbook1', 'workbook2']),
      viewIds: new Set(['view1', 'view2']),
      tags: new Set(['tag1', 'tag2']),
    });
    expect(config.getMaxResultLimit('query-datasource')).toEqual(100);
    expect(config.getMaxResultLimit('list-datasources')).toEqual(20);
    expect(config.disableQueryDatasourceValidationRequests).toEqual(true);
    expect(config.disableMetadataApiRequests).toEqual(true);

    expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalledTimes(1);
  });
  describe('per-site cache keying with SITE_NAME set', () => {
    const passthroughInfo = (tokenSite: string, siteId: string = tokenSite) =>
      ({
        type: 'Passthrough',
        username: 'u',
        userId: 'uid',
        server: 'https://my-tableau-server.com',
        siteId,
        siteName: siteId,
        raw: `a|b|${tokenSite}|c`,
      }) as const;

    const getFor = (
      siteId: string | undefined,
      sessionSiteId?: string,
    ): ReturnType<typeof getConfigWithOverrides> =>
      getConfigWithOverrides({
        restApiArgs: {
          server: new WebMcpServer(),
          tableauAuthInfo:
            siteId !== undefined ? passthroughInfo(siteId, sessionSiteId) : undefined,
          disableLogging: true,
        },
        requestOverrides: undefined,
      });

    it('keeps separate entries for tokens on different sites', async () => {
      vi.stubEnv('ENABLE_MCP_SITE_SETTINGS', 'true');
      vi.stubEnv('SITE_NAME', 'siteA');
      mocks.mockGetMcpSiteSettings.mockReset();
      mocks.mockGetMcpSiteSettings
        .mockResolvedValueOnce({ settings: [{ key: 'INCLUDE_TOOLS', value: 'list-views' }] })
        .mockResolvedValueOnce({ settings: [{ key: 'INCLUDE_TOOLS', value: 'list-workbooks' }] });

      expect((await getFor('luid-site-b')).includeTools).toEqual(['list-views']);
      expect((await getFor('luid-site-c')).includeTools).toEqual(['list-workbooks']);
      expect((await getFor('luid-site-b')).includeTools).toEqual(['list-views']);
      expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalledTimes(2);
    });

    const axiosError = (status: number): AxiosError =>
      new AxiosError('failed', String(status), undefined, undefined, { status } as never);
    const views = { settings: [{ key: 'INCLUDE_TOOLS', value: 'list-views' }] };

    beforeEach(() => {
      vi.stubEnv('ENABLE_MCP_SITE_SETTINGS', 'true');
      mocks.mockGetMcpSiteSettings.mockReset();
    });

    it('keys on the token site part and caches only when it matches the validated session site', async () => {
      mocks.mockGetMcpSiteSettings
        .mockResolvedValueOnce(views)
        .mockResolvedValueOnce({ settings: [{ key: 'INCLUDE_TOOLS', value: 'list-workbooks' }] });

      expect((await getFor('tok-site-1')).includeTools).toEqual(['list-views']);
      expect((await getFor('tok-site-1')).includeTools).toEqual(['list-views']);
      expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalledTimes(1);

      // Token site differs from the session site: fetched, never read from or written to the cache.
      expect((await getFor('tok-site-1', 'other-session')).includeTools).toEqual([
        'list-workbooks',
      ]);
      expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalledTimes(2);
      expect((await getFor('tok-site-1')).includeTools).toEqual(['list-views']);
      expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['a 403', axiosError(403)],
      ['a plain Error', new Error('boom')],
    ])(
      'a forged site part with %s does not plant an entry for the victim site',
      async (name, err) => {
        const victim = `victim-${name.replace(/ /g, '-')}`;
        mocks.mockGetMcpSiteSettings.mockRejectedValueOnce(err).mockResolvedValue(views);

        await getFor(victim, 'attacker-session');
        expect((await getFor(victim)).includeTools).toEqual(['list-views']);
        expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalledTimes(2);
      },
    );

    it('matches the token site part and session site case-insensitively', async () => {
      mocks.mockGetMcpSiteSettings.mockResolvedValue(views);

      await getFor('ABC-B', 'abc-b');
      await getFor('ABC-B', 'abc-b');
      expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalledTimes(1);
    });

    it('does not cache when the token site part and session site are both empty', async () => {
      mocks.mockGetMcpSiteSettings.mockResolvedValue(views);

      await getFor('', '');
      await getFor('', '');
      expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalledTimes(2);
    });

    it('logs the retryable fetch failure once per site, not on every request', async () => {
      const spy = vi.spyOn(logger, 'log').mockImplementation(() => {});
      mocks.mockGetMcpSiteSettings.mockRejectedValue(new Error('boom'));

      await getFor('warn-once');
      await getFor('warn-once');
      await getFor('warn-once');

      expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalledTimes(3);
      expect(spy.mock.calls.filter(([e]) => e.level === 'warning')).toHaveLength(1);
      spy.mockRestore();
    });

    it('logs one warning for 50 uncacheable requests with forged unique site parts', async () => {
      const spy = vi.spyOn(logger, 'log').mockImplementation(() => {});
      mocks.mockGetMcpSiteSettings.mockRejectedValue(new Error('boom'));

      for (let i = 0; i < 50; i++) {
        await getFor(`forged-${i}`, 'attacker-session');
      }

      expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalledTimes(50);
      // The shared 'uncacheable' key may already have warned in an earlier test, so allow 0 or 1.
      expect(spy.mock.calls.filter(([e]) => e.level === 'warning').length).toBeLessThanOrEqual(1);
      spy.mockRestore();
    });

    it('caches empty settings once for an honest token when the feature is disabled (403)', async () => {
      mocks.mockGetMcpSiteSettings.mockRejectedValue(axiosError(403));

      expect((await getFor('honest-403')).includeTools).toEqual([]);
      expect((await getFor('honest-403')).includeTools).toEqual([]);
      expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalledTimes(1);
    });

    it('does not cache a non-axios error, so the next request retries', async () => {
      mocks.mockGetMcpSiteSettings
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue(views);

      expect((await getFor('honest-err')).includeTools).toEqual([]);
      expect((await getFor('honest-err')).includeTools).toEqual(['list-views']);
      expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalledTimes(2);
    });

    it('uses SITE_NAME as the key only when there is no auth info', async () => {
      vi.stubEnv('ENABLE_MCP_SITE_SETTINGS', 'true');
      vi.stubEnv('SITE_NAME', 'siteD');
      mocks.mockGetMcpSiteSettings.mockReset();
      mocks.mockGetMcpSiteSettings.mockResolvedValue({
        settings: [{ key: 'INCLUDE_TOOLS', value: 'list-views' }],
      });

      await getFor(undefined);
      await getFor(undefined);
      expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalledTimes(1);

      await getFor('luid-site-e');
      expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalledTimes(2);
    });
    it('does not mix a site name with an equal-looking site LUID', async () => {
      vi.stubEnv('ENABLE_MCP_SITE_SETTINGS', 'true');
      vi.stubEnv('SITE_NAME', 'luid-site-f');
      mocks.mockGetMcpSiteSettings.mockReset();
      mocks.mockGetMcpSiteSettings.mockResolvedValue({ settings: [] });

      await getFor(undefined);
      await getFor('luid-site-f');

      expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalledTimes(2);
    });
  });
});
