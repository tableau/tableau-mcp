import { AxiosError } from 'axios';

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

  // W-23757363: a bad/expired PAT made the startup site-settings fetch 401, which used to throw and
  // take the whole server down before any tools registered — so an auth failure looked like a
  // connection failure. It must now degrade gracefully: resolve with default (empty) overrides so
  // the base tools still register and the server connects.
  it('should not throw and should continue with defaults when site-settings fetch returns 401', async () => {
    vi.stubEnv('ENABLE_MCP_SITE_SETTINGS', 'true');
    // Unique site name so this test does not read/populate the shared module-level cache.
    vi.stubEnv('SITE_NAME', 'auth-401-site');

    mocks.mockGetMcpSiteSettings.mockClear();
    const axios401 = new AxiosError('Request failed with status code 401');
    axios401.response = { status: 401 } as AxiosError['response'];
    mocks.mockGetMcpSiteSettings.mockRejectedValue(axios401);

    const config = await getConfigWithOverrides({
      restApiArgs: {
        server: new WebMcpServer(),
        tableauAuthInfo: undefined,
        disableLogging: true,
      },
      requestOverrides: undefined,
    });

    // Degraded gracefully: default (empty) overrides, no throw.
    expect(config.includeTools).toEqual([]);
    expect(config.excludeTools).toEqual([]);
    expect(config.getMaxResultLimit('query-datasource')).toEqual(null);
    expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalledTimes(1);
  });

  it('should still throw on an unexpected (non-401/403/500) site-settings error', async () => {
    vi.stubEnv('ENABLE_MCP_SITE_SETTINGS', 'true');
    vi.stubEnv('SITE_NAME', 'auth-502-site');

    mocks.mockGetMcpSiteSettings.mockClear();
    const axios502 = new AxiosError('Bad Gateway');
    axios502.response = { status: 502 } as AxiosError['response'];
    mocks.mockGetMcpSiteSettings.mockRejectedValue(axios502);

    await expect(
      getConfigWithOverrides({
        restApiArgs: {
          server: new WebMcpServer(),
          tableauAuthInfo: undefined,
          disableLogging: true,
        },
        requestOverrides: undefined,
      }),
    ).rejects.toThrow('An unexpected error occurred while getting MCP settings for site');
  });
});
