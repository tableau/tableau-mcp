import { Server } from '../server';
import { stubDefaultEnvVars } from '../testShared';
import { getConfigWithOverrides } from './mcpSiteSettings';

const mocks = vi.hoisted(() => ({
  mockGetMcpSiteSettings: vi.fn(),
}));

vi.mock('../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      siteMethods: {
        getMcpSettings: mocks.mockGetMcpSiteSettings,
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
        server: new Server(),
        disableLogging: true,
      },
    });

    expect(config.includeTools).toEqual([]);
    expect(config.excludeTools).toEqual([]);
    expect(config.boundedContext).toEqual({
      projectIds: null,
      datasourceIds: null,
      workbookIds: null,
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
      INCLUDE_TOOLS: 'list-views,list-datasources',
      INCLUDE_PROJECT_IDS: 'project1,project2',
      INCLUDE_DATASOURCE_IDS: 'datasource1,datasource2',
      INCLUDE_WORKBOOK_IDS: 'workbook1,workbook2',
      INCLUDE_TAGS: 'tag1,tag2',
      MAX_RESULT_LIMIT: '100',
      MAX_RESULT_LIMITS: 'query-datasource:100,list-datasources:20',
      DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS: 'true',
      DISABLE_METADATA_API_REQUESTS: 'true',
    });

    let config = await getConfigWithOverrides({
      restApiArgs: {
        server: new Server(),
        disableLogging: true,
      },
    });

    expect(config.includeTools).toEqual(['list-views', 'list-datasources']);
    expect(config.excludeTools).toEqual([]);
    expect(config.boundedContext).toEqual({
      projectIds: new Set(['project1', 'project2']),
      datasourceIds: new Set(['datasource1', 'datasource2']),
      workbookIds: new Set(['workbook1', 'workbook2']),
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
        server: new Server(),
        disableLogging: true,
      },
    });

    expect(config.includeTools).toEqual(['list-views', 'list-datasources']);
    expect(config.excludeTools).toEqual([]);
    expect(config.boundedContext).toEqual({
      projectIds: new Set(['project1', 'project2']),
      datasourceIds: new Set(['datasource1', 'datasource2']),
      workbookIds: new Set(['workbook1', 'workbook2']),
      tags: new Set(['tag1', 'tag2']),
    });
    expect(config.getMaxResultLimit('query-datasource')).toEqual(100);
    expect(config.getMaxResultLimit('list-datasources')).toEqual(20);
    expect(config.disableQueryDatasourceValidationRequests).toEqual(true);
    expect(config.disableMetadataApiRequests).toEqual(true);

    expect(mocks.mockGetMcpSiteSettings).toHaveBeenCalledTimes(1);
  });
});
