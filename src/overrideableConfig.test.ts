import { exportedForTesting } from './overrideableConfig.js';
import { stubDefaultEnvVars } from './testShared.js';

describe('OverrideableConfig', () => {
  const { OverrideableConfig } = exportedForTesting;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should set disableQueryDatasourceValidationRequests to false by default', () => {
    const config = new OverrideableConfig({});
    expect(config.disableQueryDatasourceValidationRequests).toBe(false);
  });

  it('should set disableQueryDatasourceValidationRequests to true when specified', () => {
    vi.stubEnv('DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS', 'true');

    const config = new OverrideableConfig({});
    expect(config.disableQueryDatasourceValidationRequests).toBe(true);
  });

  it('should set disableMetadataApiRequests to false by default', () => {
    const config = new OverrideableConfig({});
    expect(config.disableMetadataApiRequests).toBe(false);
  });

  it('should set disableMetadataApiRequests to true when specified', () => {
    vi.stubEnv('DISABLE_METADATA_API_REQUESTS', 'true');

    const config = new OverrideableConfig({});
    expect(config.disableMetadataApiRequests).toBe(true);
  });

  describe('Tool filtering', () => {
    it('should set empty arrays for includeTools and excludeTools when not specified', () => {
      const config = new OverrideableConfig({});
      expect(config.includeTools).toEqual([]);
      expect(config.excludeTools).toEqual([]);
    });

    it('should parse INCLUDE_TOOLS into an array of valid tool names', () => {
      vi.stubEnv('INCLUDE_TOOLS', 'query-datasource,get-datasource-metadata');

      const config = new OverrideableConfig({});
      expect(config.includeTools).toEqual(['query-datasource', 'get-datasource-metadata']);
    });

    it('should parse INCLUDE_TOOLS into an array of valid tool names when tool group names are used', () => {
      vi.stubEnv('INCLUDE_TOOLS', 'query-datasource,workbook');

      const config = new OverrideableConfig({});
      expect(config.includeTools).toEqual(['query-datasource', 'list-workbooks', 'get-workbook']);
    });

    it('should parse EXCLUDE_TOOLS into an array of valid tool names', () => {
      vi.stubEnv('EXCLUDE_TOOLS', 'query-datasource');

      const config = new OverrideableConfig({});
      expect(config.excludeTools).toEqual(['query-datasource']);
    });

    it('should parse EXCLUDE_TOOLS into an array of valid tool names when tool group names are used', () => {
      vi.stubEnv('EXCLUDE_TOOLS', 'query-datasource,workbook');

      const config = new OverrideableConfig({});
      expect(config.excludeTools).toEqual(['query-datasource', 'list-workbooks', 'get-workbook']);
    });

    it('should filter out invalid tool names from INCLUDE_TOOLS', () => {
      vi.stubEnv('INCLUDE_TOOLS', 'query-datasource,order-hamburgers');

      const config = new OverrideableConfig({});
      expect(config.includeTools).toEqual(['query-datasource']);
    });

    it('should filter out invalid tool names from EXCLUDE_TOOLS', () => {
      vi.stubEnv('EXCLUDE_TOOLS', 'query-datasource,order-hamburgers');

      const config = new OverrideableConfig({});
      expect(config.excludeTools).toEqual(['query-datasource']);
    });

    it('should throw error when both INCLUDE_TOOLS and EXCLUDE_TOOLS are specified', () => {
      vi.stubEnv('INCLUDE_TOOLS', 'query-datasource');
      vi.stubEnv('EXCLUDE_TOOLS', 'get-datasource-metadata');

      expect(() => new OverrideableConfig({})).toThrow(
        'Cannot include and exclude tools simultaneously',
      );
    });

    it('should throw error when both INCLUDE_TOOLS and EXCLUDE_TOOLS are specified with tool group names', () => {
      vi.stubEnv('INCLUDE_TOOLS', 'datasource');
      vi.stubEnv('EXCLUDE_TOOLS', 'workbook');
      expect(() => new OverrideableConfig({})).toThrow(
        'Cannot include and exclude tools simultaneously',
      );
    });
  });

  describe('Bounded context parsing', () => {
    it('should set boundedContext to null sets when no project, datasource, or workbook IDs are provided', () => {
      const config = new OverrideableConfig({});
      expect(config.boundedContext).toEqual({
        projectIds: null,
        datasourceIds: null,
        workbookIds: null,
        tags: null,
      });
    });

    it('should set boundedContext to the specified tags and project, datasource, and workbook IDs when provided', () => {
      vi.stubEnv('INCLUDE_PROJECT_IDS', ' 123, 456, 123   '); // spacing is intentional here to test trimming
      vi.stubEnv('INCLUDE_DATASOURCE_IDS', '789,101');
      vi.stubEnv('INCLUDE_WORKBOOK_IDS', '112,113');
      vi.stubEnv('INCLUDE_TAGS', 'tag1,tag2');

      const config = new OverrideableConfig({});
      expect(config.boundedContext).toEqual({
        projectIds: new Set(['123', '456']),
        datasourceIds: new Set(['789', '101']),
        workbookIds: new Set(['112', '113']),
        tags: new Set(['tag1', 'tag2']),
      });
    });

    it('should throw error when INCLUDE_PROJECT_IDS is set to an empty string', () => {
      vi.stubEnv('INCLUDE_PROJECT_IDS', '');

      expect(() => new OverrideableConfig({})).toThrow(
        'When set, the environment variable INCLUDE_PROJECT_IDS must have at least one value',
      );
    });

    it('should throw error when INCLUDE_DATASOURCE_IDS is set to an empty string', () => {
      vi.stubEnv('INCLUDE_DATASOURCE_IDS', '');

      expect(() => new OverrideableConfig({})).toThrow(
        'When set, the environment variable INCLUDE_DATASOURCE_IDS must have at least one value',
      );
    });

    it('should throw error when INCLUDE_WORKBOOK_IDS is set to an empty string', () => {
      vi.stubEnv('INCLUDE_WORKBOOK_IDS', '');

      expect(() => new OverrideableConfig({})).toThrow(
        'When set, the environment variable INCLUDE_WORKBOOK_IDS must have at least one value',
      );
    });

    it('should throw error when INCLUDE_TAGS is set to an empty string', () => {
      vi.stubEnv('INCLUDE_TAGS', '');

      expect(() => new OverrideableConfig({})).toThrow(
        'When set, the environment variable INCLUDE_TAGS must have at least one value',
      );
    });
  });

  describe('Max results limit parsing', () => {
    it('should return null when MAX_RESULT_LIMIT and MAX_RESULT_LIMITS are not set', () => {
      expect(new OverrideableConfig({}).getMaxResultLimit('query-datasource')).toBeNull();
    });

    it('should return the max result limit when MAX_RESULT_LIMITS has a single tool', () => {
      vi.stubEnv('MAX_RESULT_LIMITS', 'query-datasource:100');

      expect(new OverrideableConfig({}).getMaxResultLimit('query-datasource')).toEqual(100);
    });

    it('should return the max result limit when MAX_RESULT_LIMITS has a single tool group', () => {
      vi.stubEnv('MAX_RESULT_LIMITS', 'datasource:200');

      expect(new OverrideableConfig({}).getMaxResultLimit('query-datasource')).toEqual(200);
    });

    it('should return the max result limit for the tool when a tool and a tool group are both specified', () => {
      vi.stubEnv('MAX_RESULT_LIMITS', 'query-datasource:100,datasource:200');

      expect(new OverrideableConfig({}).getMaxResultLimit('query-datasource')).toEqual(100);
      expect(new OverrideableConfig({}).getMaxResultLimit('list-datasources')).toEqual(200);
    });

    it('should fallback to MAX_RESULT_LIMIT when a tool-specific max result limit is not set', () => {
      vi.stubEnv('MAX_RESULT_LIMITS', 'query-datasource:100');
      vi.stubEnv('MAX_RESULT_LIMIT', '300');

      expect(new OverrideableConfig({}).getMaxResultLimit('query-datasource')).toEqual(100);
      expect(new OverrideableConfig({}).getMaxResultLimit('list-datasources')).toEqual(300);
    });

    it('should return null when MAX_RESULT_LIMITS has a non-number', () => {
      vi.stubEnv('MAX_RESULT_LIMITS', 'query-datasource:abc');

      const config = new OverrideableConfig({});
      expect(config.getMaxResultLimit('query-datasource')).toBe(null);
    });

    it('should return null when MAX_RESULT_LIMIT is specified as a non-number', () => {
      vi.stubEnv('MAX_RESULT_LIMIT', 'abc');

      const config = new OverrideableConfig({});
      expect(config.getMaxResultLimit('query-datasource')).toBe(null);
    });

    it('should return null when MAX_RESULT_LIMITS has a negative number', () => {
      vi.stubEnv('MAX_RESULT_LIMITS', 'query-datasource:-100');

      const config = new OverrideableConfig({});
      expect(config.getMaxResultLimit('query-datasource')).toBe(null);
    });

    it('should return null when MAX_RESULT_LIMIT is specified as a negative number', () => {
      vi.stubEnv('MAX_RESULT_LIMIT', '-100');

      const config = new OverrideableConfig({});
      expect(config.getMaxResultLimit('query-datasource')).toBe(null);
    });
  });

  describe('Override behavior', () => {
    it('should override INCLUDE_TOOLS', () => {
      vi.stubEnv('INCLUDE_TOOLS', 'list-views');

      const config = new OverrideableConfig({
        INCLUDE_TOOLS: 'query-datasource',
      });

      expect(config.includeTools).toEqual(['query-datasource']);
    });

    it('should override EXCLUDE_TOOLS', () => {
      vi.stubEnv('EXCLUDE_TOOLS', 'list-views');

      const config = new OverrideableConfig({
        EXCLUDE_TOOLS: 'get-datasource-metadata',
      });

      expect(config.excludeTools).toEqual(['get-datasource-metadata']);
    });

    it('should override INCLUDE_PROJECT_IDS', () => {
      vi.stubEnv('INCLUDE_PROJECT_IDS', '999');

      const config = new OverrideableConfig({
        INCLUDE_PROJECT_IDS: '123,456',
      });

      expect(config.boundedContext.projectIds).toEqual(new Set(['123', '456']));
    });

    it('should override INCLUDE_DATASOURCE_IDS', () => {
      vi.stubEnv('INCLUDE_DATASOURCE_IDS', '999');

      const config = new OverrideableConfig({
        INCLUDE_DATASOURCE_IDS: '123,456',
      });

      expect(config.boundedContext.datasourceIds).toEqual(new Set(['123', '456']));
    });

    it('should override INCLUDE_WORKBOOK_IDS', () => {
      vi.stubEnv('INCLUDE_WORKBOOK_IDS', '999');

      const config = new OverrideableConfig({
        INCLUDE_WORKBOOK_IDS: '123,456',
      });

      expect(config.boundedContext.workbookIds).toEqual(new Set(['123', '456']));
    });

    it('should override INCLUDE_TAGS', () => {
      vi.stubEnv('INCLUDE_TAGS', '999');

      const config = new OverrideableConfig({
        INCLUDE_TAGS: '123,456',
      });

      expect(config.boundedContext.tags).toEqual(new Set(['123', '456']));
    });

    it('should override MAX_RESULT_LIMIT', () => {
      vi.stubEnv('MAX_RESULT_LIMIT', '10');

      const config = new OverrideableConfig({
        MAX_RESULT_LIMIT: '99',
      });

      expect(config.getMaxResultLimit('query-datasource')).toEqual(99);
    });

    it('should override MAX_RESULT_LIMITS', () => {
      vi.stubEnv('MAX_RESULT_LIMIT', '10');
      vi.stubEnv('MAX_RESULT_LIMITS', 'query-datasource:100');

      const config = new OverrideableConfig({
        MAX_RESULT_LIMIT: '99',
        MAX_RESULT_LIMITS: 'query-datasource:999',
      });

      expect(config.getMaxResultLimit('list-datasources')).toEqual(99);
      expect(config.getMaxResultLimit('query-datasource')).toEqual(999);
    });

    it('should override DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS', () => {
      vi.stubEnv('DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS', 'false');

      const config = new OverrideableConfig({
        DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS: 'true',
      });

      expect(config.disableQueryDatasourceValidationRequests).toEqual(true);
    });

    it('should override DISABLE_METADATA_API_REQUESTS', () => {
      vi.stubEnv('DISABLE_METADATA_API_REQUESTS', 'false');

      const config = new OverrideableConfig({
        DISABLE_METADATA_API_REQUESTS: 'true',
      });

      expect(config.disableMetadataApiRequests).toEqual(true);
    });
  });
});
