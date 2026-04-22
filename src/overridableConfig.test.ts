import { exportedForTesting, requestOverridableVariables } from './overridableConfig.js';
import { stubDefaultEnvVars } from './testShared.js';

describe('OverridableConfig', () => {
  const { OverridableConfig } = exportedForTesting;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should set disableQueryDatasourceValidationRequests to false by default', () => {
    const config = new OverridableConfig({});
    expect(config.disableQueryDatasourceValidationRequests).toBe(false);
  });

  it('should set disableQueryDatasourceValidationRequests to true when specified', () => {
    vi.stubEnv('DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS', 'true');

    const config = new OverridableConfig({});
    expect(config.disableQueryDatasourceValidationRequests).toBe(true);
  });

  it('should set disableMetadataApiRequests to false by default', () => {
    const config = new OverridableConfig({});
    expect(config.disableMetadataApiRequests).toBe(false);
  });

  it('should set disableMetadataApiRequests to true when specified', () => {
    vi.stubEnv('DISABLE_METADATA_API_REQUESTS', 'true');

    const config = new OverridableConfig({});
    expect(config.disableMetadataApiRequests).toBe(true);
  });

  describe('Tool filtering', () => {
    it('should set empty arrays for includeTools and excludeTools when not specified', () => {
      const config = new OverridableConfig({});
      expect(config.includeTools).toEqual([]);
      expect(config.excludeTools).toEqual([]);
    });

    it('should parse INCLUDE_TOOLS into an array of valid tool names', () => {
      vi.stubEnv('INCLUDE_TOOLS', 'query-datasource,get-datasource-metadata');

      const config = new OverridableConfig({});
      expect(config.includeTools).toEqual(['query-datasource', 'get-datasource-metadata']);
    });

    it('should parse INCLUDE_TOOLS into an array of valid tool names when tool group names are used', () => {
      vi.stubEnv('INCLUDE_TOOLS', 'query-datasource,workbook');

      const config = new OverridableConfig({});
      expect(config.includeTools).toEqual(['query-datasource', 'list-workbooks', 'get-workbook']);
    });

    it('should parse EXCLUDE_TOOLS into an array of valid tool names', () => {
      vi.stubEnv('EXCLUDE_TOOLS', 'query-datasource');

      const config = new OverridableConfig({});
      expect(config.excludeTools).toEqual(['query-datasource']);
    });

    it('should parse EXCLUDE_TOOLS into an array of valid tool names when tool group names are used', () => {
      vi.stubEnv('EXCLUDE_TOOLS', 'query-datasource,workbook');

      const config = new OverridableConfig({});
      expect(config.excludeTools).toEqual(['query-datasource', 'list-workbooks', 'get-workbook']);
    });

    it('should filter out invalid tool names from INCLUDE_TOOLS', () => {
      vi.stubEnv('INCLUDE_TOOLS', 'query-datasource,order-hamburgers');

      const config = new OverridableConfig({});
      expect(config.includeTools).toEqual(['query-datasource']);
    });

    it('should filter out invalid tool names from EXCLUDE_TOOLS', () => {
      vi.stubEnv('EXCLUDE_TOOLS', 'query-datasource,order-hamburgers');

      const config = new OverridableConfig({});
      expect(config.excludeTools).toEqual(['query-datasource']);
    });

    it('should throw error when both INCLUDE_TOOLS and EXCLUDE_TOOLS are specified', () => {
      vi.stubEnv('INCLUDE_TOOLS', 'query-datasource');
      vi.stubEnv('EXCLUDE_TOOLS', 'get-datasource-metadata');

      expect(() => new OverridableConfig({})).toThrow(
        'Cannot include and exclude tools simultaneously',
      );
    });

    it('should throw error when both INCLUDE_TOOLS and EXCLUDE_TOOLS are specified with tool group names', () => {
      vi.stubEnv('INCLUDE_TOOLS', 'datasource');
      vi.stubEnv('EXCLUDE_TOOLS', 'workbook');
      expect(() => new OverridableConfig({})).toThrow(
        'Cannot include and exclude tools simultaneously',
      );
    });
  });

  describe('Bounded context parsing', () => {
    it('should set boundedContext to null sets when no project, datasource, or workbook IDs are provided', () => {
      const config = new OverridableConfig({});
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

      const config = new OverridableConfig({});
      expect(config.boundedContext).toEqual({
        projectIds: new Set(['123', '456']),
        datasourceIds: new Set(['789', '101']),
        workbookIds: new Set(['112', '113']),
        tags: new Set(['tag1', 'tag2']),
      });
    });

    it('should throw error when INCLUDE_PROJECT_IDS is set to an empty string', () => {
      vi.stubEnv('INCLUDE_PROJECT_IDS', '');

      expect(() => new OverridableConfig({})).toThrow(
        'When set, the environment variable INCLUDE_PROJECT_IDS must have at least one value',
      );
    });

    it('should throw error when INCLUDE_DATASOURCE_IDS is set to an empty string', () => {
      vi.stubEnv('INCLUDE_DATASOURCE_IDS', '');

      expect(() => new OverridableConfig({})).toThrow(
        'When set, the environment variable INCLUDE_DATASOURCE_IDS must have at least one value',
      );
    });

    it('should throw error when INCLUDE_WORKBOOK_IDS is set to an empty string', () => {
      vi.stubEnv('INCLUDE_WORKBOOK_IDS', '');

      expect(() => new OverridableConfig({})).toThrow(
        'When set, the environment variable INCLUDE_WORKBOOK_IDS must have at least one value',
      );
    });

    it('should throw error when INCLUDE_TAGS is set to an empty string', () => {
      vi.stubEnv('INCLUDE_TAGS', '');

      expect(() => new OverridableConfig({})).toThrow(
        'When set, the environment variable INCLUDE_TAGS must have at least one value',
      );
    });
  });

  describe('Max results limit parsing', () => {
    it('should return null when MAX_RESULT_LIMIT and MAX_RESULT_LIMITS are not set', () => {
      expect(new OverridableConfig({}).getMaxResultLimit('query-datasource')).toBeNull();
    });

    it('should return the max result limit when MAX_RESULT_LIMITS has a single tool', () => {
      vi.stubEnv('MAX_RESULT_LIMITS', 'query-datasource:100');

      expect(new OverridableConfig({}).getMaxResultLimit('query-datasource')).toEqual(100);
    });

    it('should return the max result limit when MAX_RESULT_LIMITS has a single tool group', () => {
      vi.stubEnv('MAX_RESULT_LIMITS', 'datasource:200');

      expect(new OverridableConfig({}).getMaxResultLimit('query-datasource')).toEqual(200);
    });

    it('should return the max result limit for the tool when a tool and a tool group are both specified', () => {
      vi.stubEnv('MAX_RESULT_LIMITS', 'query-datasource:100,datasource:200');

      expect(new OverridableConfig({}).getMaxResultLimit('query-datasource')).toEqual(100);
      expect(new OverridableConfig({}).getMaxResultLimit('list-datasources')).toEqual(200);
    });

    it('should fallback to MAX_RESULT_LIMIT when a tool-specific max result limit is not set', () => {
      vi.stubEnv('MAX_RESULT_LIMITS', 'query-datasource:100');
      vi.stubEnv('MAX_RESULT_LIMIT', '300');

      expect(new OverridableConfig({}).getMaxResultLimit('query-datasource')).toEqual(100);
      expect(new OverridableConfig({}).getMaxResultLimit('list-datasources')).toEqual(300);
    });

    it('should return null when MAX_RESULT_LIMITS has a non-number', () => {
      vi.stubEnv('MAX_RESULT_LIMITS', 'query-datasource:abc');

      const config = new OverridableConfig({});
      expect(config.getMaxResultLimit('query-datasource')).toBe(null);
    });

    it('should return null when MAX_RESULT_LIMIT is specified as a non-number', () => {
      vi.stubEnv('MAX_RESULT_LIMIT', 'abc');

      const config = new OverridableConfig({});
      expect(config.getMaxResultLimit('query-datasource')).toBe(null);
    });

    it('should return null when MAX_RESULT_LIMITS has a negative number', () => {
      vi.stubEnv('MAX_RESULT_LIMITS', 'query-datasource:-100');

      const config = new OverridableConfig({});
      expect(config.getMaxResultLimit('query-datasource')).toBe(null);
    });

    it('should return null when MAX_RESULT_LIMIT is specified as a negative number', () => {
      vi.stubEnv('MAX_RESULT_LIMIT', '-100');

      const config = new OverridableConfig({});
      expect(config.getMaxResultLimit('query-datasource')).toBe(null);
    });
  });

  describe('Site Override behavior', () => {
    it('should override INCLUDE_TOOLS', () => {
      // positive override case
      vi.stubEnv('INCLUDE_TOOLS', 'list-views');
      const config = new OverridableConfig({
        INCLUDE_TOOLS: 'query-datasource',
      });
      expect(config.includeTools).toEqual(['query-datasource']);
      expect(config.excludeTools).toEqual([]);

      // clear tool scopes with empty string
      const config2 = new OverridableConfig({
        INCLUDE_TOOLS: '',
      });
      expect(config2.includeTools).toEqual([]);

      // should fall back to environment variable if both INCLUDE_TOOLS and EXCLUDE_TOOLS are set
      const config3 = new OverridableConfig({
        INCLUDE_TOOLS: 'query-datasource',
        EXCLUDE_TOOLS: 'list-views',
      });
      expect(config3.includeTools).toEqual(['list-views']);
      expect(config3.excludeTools).toEqual([]);

      // invalid overrides are ignored / treated same as empty string
      const config4 = new OverridableConfig({
        INCLUDE_TOOLS: 'invalid',
      });
      expect(config4.includeTools).toEqual([]);
      expect(config4.excludeTools).toEqual([]);

      // global EXCLUDE_TOOLS and site overrides INCLUDE_TOOLS should not conflict
      vi.unstubAllEnvs();
      vi.stubEnv('EXCLUDE_TOOLS', 'list-views');
      const config5 = new OverridableConfig({
        INCLUDE_TOOLS: 'query-datasource',
      });
      expect(config5.includeTools).toEqual(['query-datasource']);
      expect(config5.excludeTools).toEqual([]);
    });

    it('should override EXCLUDE_TOOLS', () => {
      // positive override case
      vi.stubEnv('EXCLUDE_TOOLS', 'list-views');
      const config = new OverridableConfig({
        EXCLUDE_TOOLS: 'query-datasource',
      });
      expect(config.excludeTools).toEqual(['query-datasource']);
      expect(config.includeTools).toEqual([]);

      // clear tool scopes with empty string
      const config2 = new OverridableConfig({
        EXCLUDE_TOOLS: '',
      });
      expect(config2.excludeTools).toEqual([]);
      expect(config2.includeTools).toEqual([]);

      // should fall back to environment variable if both INCLUDE_TOOLS and EXCLUDE_TOOLS are set
      const config3 = new OverridableConfig({
        INCLUDE_TOOLS: 'query-datasource',
        EXCLUDE_TOOLS: 'list-views',
      });
      expect(config3.excludeTools).toEqual(['list-views']);
      expect(config3.includeTools).toEqual([]);

      // invalid overrides are ignored / treated same as empty string
      const config4 = new OverridableConfig({
        EXCLUDE_TOOLS: 'invalid',
      });
      expect(config4.excludeTools).toEqual([]);
      expect(config4.includeTools).toEqual([]);

      // global EXCLUDE_TOOLS and site overrides INCLUDE_TOOLS should not conflict
      vi.unstubAllEnvs();
      vi.stubEnv('INCLUDE_TOOLS', 'list-views');
      const config5 = new OverridableConfig({
        EXCLUDE_TOOLS: 'query-datasource',
      });
      expect(config5.excludeTools).toEqual(['query-datasource']);
      expect(config5.includeTools).toEqual([]);
    });

    it('should override INCLUDE_PROJECT_IDS', () => {
      vi.stubEnv('INCLUDE_PROJECT_IDS', '999');

      const config = new OverridableConfig({
        INCLUDE_PROJECT_IDS: '123,456',
      });

      expect(config.boundedContext.projectIds).toEqual(new Set(['123', '456']));

      // should clear project IDs with empty string
      const config2 = new OverridableConfig({
        INCLUDE_PROJECT_IDS: '',
      });
      expect(config2.boundedContext.projectIds).toEqual(null);

      // should fall back to environment variable resulting override set is empty
      const config3 = new OverridableConfig({
        INCLUDE_PROJECT_IDS: ',,,,,,,',
      });
      expect(config3.boundedContext.projectIds).toEqual(new Set(['999']));
    });

    it('should override INCLUDE_DATASOURCE_IDS', () => {
      vi.stubEnv('INCLUDE_DATASOURCE_IDS', '999');

      const config = new OverridableConfig({
        INCLUDE_DATASOURCE_IDS: '123,456',
      });

      expect(config.boundedContext.datasourceIds).toEqual(new Set(['123', '456']));

      // should clear project IDs with empty string
      const config2 = new OverridableConfig({
        INCLUDE_DATASOURCE_IDS: '',
      });
      expect(config2.boundedContext.datasourceIds).toEqual(null);

      // should fall back to environment variable resulting override set is empty
      const config3 = new OverridableConfig({
        INCLUDE_DATASOURCE_IDS: ',,,,,,,',
      });
      expect(config3.boundedContext.datasourceIds).toEqual(new Set(['999']));
    });

    it('should override INCLUDE_WORKBOOK_IDS', () => {
      vi.stubEnv('INCLUDE_WORKBOOK_IDS', '999');

      const config = new OverridableConfig({
        INCLUDE_WORKBOOK_IDS: '123,456',
      });

      expect(config.boundedContext.workbookIds).toEqual(new Set(['123', '456']));

      // should clear workbook IDs with empty string
      const config2 = new OverridableConfig({
        INCLUDE_WORKBOOK_IDS: '',
      });
      expect(config2.boundedContext.workbookIds).toEqual(null);

      // should fall back to environment variable resulting override set is empty
      const config3 = new OverridableConfig({
        INCLUDE_WORKBOOK_IDS: ',,,,,,,',
      });
      expect(config3.boundedContext.workbookIds).toEqual(new Set(['999']));
    });

    it('should override INCLUDE_TAGS', () => {
      vi.stubEnv('INCLUDE_TAGS', '999');

      const config = new OverridableConfig({
        INCLUDE_TAGS: '123,456',
      });

      expect(config.boundedContext.tags).toEqual(new Set(['123', '456']));

      // should clear tags with empty string
      const config2 = new OverridableConfig({
        INCLUDE_TAGS: '',
      });
      expect(config2.boundedContext.tags).toEqual(null);

      // should fall back to environment variable resulting override set is empty
      const config3 = new OverridableConfig({
        INCLUDE_TAGS: ',,,,,,,',
      });
      expect(config3.boundedContext.tags).toEqual(new Set(['999']));
    });

    it('should override MAX_RESULT_LIMIT', () => {
      vi.stubEnv('MAX_RESULT_LIMIT', '10');

      const config = new OverridableConfig({
        MAX_RESULT_LIMIT: '99',
      });

      expect(config.getMaxResultLimit('query-datasource')).toEqual(99);

      const config2 = new OverridableConfig({
        MAX_RESULT_LIMIT: '',
      });
      expect(config2.getMaxResultLimit('query-datasource')).toEqual(null);

      // should fall back to environment variable if MAX_RESULT_LIMIT is invalid
      const config3 = new OverridableConfig({
        MAX_RESULT_LIMIT: '-1',
      });
      expect(config3.getMaxResultLimit('query-datasource')).toEqual(10);
    });

    it('should override MAX_RESULT_LIMITS', () => {
      vi.stubEnv('MAX_RESULT_LIMIT', '10');
      vi.stubEnv('MAX_RESULT_LIMITS', 'query-datasource:100');

      const config = new OverridableConfig({
        MAX_RESULT_LIMIT: '99',
        MAX_RESULT_LIMITS: 'query-datasource:999',
      });

      expect(config.getMaxResultLimit('list-datasources')).toEqual(99);
      expect(config.getMaxResultLimit('query-datasource')).toEqual(999);

      // should fall back to MAX_RESULT_LIMITS enviroment variable is invalid
      const config2 = new OverridableConfig({
        MAX_RESULT_LIMIT: '99',
        MAX_RESULT_LIMITS: 'invalid',
      });
      expect(config2.getMaxResultLimit('query-datasource')).toEqual(100);

      // should allow unbounded tool specific limits
      const config3 = new OverridableConfig({
        MAX_RESULT_LIMIT: '99',
        MAX_RESULT_LIMITS: 'query-datasource:*',
      });
      expect(config3.getMaxResultLimit('query-datasource')).toEqual(null);
    });

    it('should override DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS', () => {
      vi.stubEnv('DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS', 'false');

      const config = new OverridableConfig({
        DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS: 'true',
      });

      expect(config.disableQueryDatasourceValidationRequests).toEqual(true);
    });

    it('should override DISABLE_METADATA_API_REQUESTS', () => {
      vi.stubEnv('DISABLE_METADATA_API_REQUESTS', 'false');

      const config = new OverridableConfig({
        DISABLE_METADATA_API_REQUESTS: 'true',
      });

      expect(config.disableMetadataApiRequests).toEqual(true);
    });
  });

  describe('ALLOWED_REQUEST_OVERRIDES', () => {
    it('should return an empty map when ALLOWED_REQUEST_OVERRIDES is not set', () => {
      const config = new OverridableConfig();
      expect(config.allowedRequestOverrides.size).toBe(0);
    });

    it('should enable all request-overridable variables as restricted when set to *', () => {
      vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', '*');

      const config = new OverridableConfig();
      expect(config.allowedRequestOverrides.size).toBe(requestOverridableVariables.length);
      for (const requestOverridableVariable of requestOverridableVariables) {
        expect(config.allowedRequestOverrides.has(requestOverridableVariable)).toBe(true);
        expect(config.allowedRequestOverrides.get(requestOverridableVariable)).toBe('restricted');
      }
    });

    it('should enable all request-overridable variables as unrestricted when set to *:unrestricted', () => {
      vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', '*:unrestricted');

      const config = new OverridableConfig();
      expect(config.allowedRequestOverrides.size).toBe(requestOverridableVariables.length);
      for (const requestOverridableVariable of requestOverridableVariables) {
        expect(config.allowedRequestOverrides.has(requestOverridableVariable)).toBe(true);
        expect(config.allowedRequestOverrides.get(requestOverridableVariable)).toBe('unrestricted');
      }
    });

    it('should enable a specific variable as restricted by default', () => {
      vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'INCLUDE_PROJECT_IDS');

      const config = new OverridableConfig();
      expect(config.allowedRequestOverrides.size).toBe(1);
      expect(config.allowedRequestOverrides.get('INCLUDE_PROJECT_IDS')).toBe('restricted');
    });

    it('should enable a specific variable as unrestricted when specified', () => {
      vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'INCLUDE_PROJECT_IDS:unrestricted');

      const config = new OverridableConfig();
      expect(config.allowedRequestOverrides.size).toBe(1);
      expect(config.allowedRequestOverrides.get('INCLUDE_PROJECT_IDS')).toBe('unrestricted');
    });

    it('should allow * with per-variable unrestricted overrides', () => {
      vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', '*,INCLUDE_PROJECT_IDS:unrestricted');

      const config = new OverridableConfig();
      expect(config.allowedRequestOverrides.size).toBe(requestOverridableVariables.length);
      for (const requestOverridableVariable of requestOverridableVariables) {
        const expectedRestriction =
          requestOverridableVariable === 'INCLUDE_PROJECT_IDS' ? 'unrestricted' : 'restricted';
        expect(config.allowedRequestOverrides.get(requestOverridableVariable)).toBe(
          expectedRestriction,
        );
      }
    });

    it('should throw when an invalid restriction type is provided', () => {
      vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'INCLUDE_PROJECT_IDS:invalid');

      expect(() => new OverridableConfig()).toThrow(
        'ALLOWED_REQUEST_OVERRIDES provides invalid restriction type: invalid',
      );
    });

    it('should throw when a non-request-overridable variable is provided', () => {
      vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'NOT_A_REAL_VARIABLE');

      expect(() => new OverridableConfig()).toThrow(
        'ALLOWED_REQUEST_OVERRIDES contains a request override variable that is not recognized: NOT_A_REAL_VARIABLE',
      );
    });

    it('should use site overrides when ALLOW_SITES_TO_CONFIGURE_REQUEST_OVERRIDES is set', () => {
      vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'INCLUDE_PROJECT_IDS');
      vi.stubEnv('ALLOW_SITES_TO_CONFIGURE_REQUEST_OVERRIDES', 'true');

      const config = new OverridableConfig({
        ALLOWED_REQUEST_OVERRIDES: '*:unrestricted',
      });

      expect(config.allowedRequestOverrides.size).toBe(requestOverridableVariables.length);
      for (const requestOverridableVariable of requestOverridableVariables) {
        expect(config.allowedRequestOverrides.get(requestOverridableVariable)).toBe('unrestricted');
      }
    });

    it('should ignore site overrides when ALLOW_SITES_TO_CONFIGURE_REQUEST_OVERRIDES is not set', () => {
      vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'INCLUDE_PROJECT_IDS');

      const config = new OverridableConfig({
        ALLOWED_REQUEST_OVERRIDES: '*:unrestricted',
      });

      expect(config.allowedRequestOverrides.size).toBe(1);
      expect(config.allowedRequestOverrides.get('INCLUDE_PROJECT_IDS')).toBe('restricted');
    });

    it('should fall back to env when site override is invalid (unrecognized key)', () => {
      vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'INCLUDE_PROJECT_IDS');
      vi.stubEnv('ALLOW_SITES_TO_CONFIGURE_REQUEST_OVERRIDES', 'true');

      const config = new OverridableConfig({
        ALLOWED_REQUEST_OVERRIDES: 'INCLUDE_TOOLS:restricted',
      });

      expect(config.allowedRequestOverrides.size).toBe(1);
      expect(config.allowedRequestOverrides.get('INCLUDE_PROJECT_IDS')).toBe('restricted');
    });

    it('should fall back to env when site override is invalid (bad restriction type)', () => {
      vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'INCLUDE_PROJECT_IDS');
      vi.stubEnv('ALLOW_SITES_TO_CONFIGURE_REQUEST_OVERRIDES', 'true');

      const config = new OverridableConfig({
        ALLOWED_REQUEST_OVERRIDES: 'INCLUDE_PROJECT_IDS:badtype',
      });

      expect(config.allowedRequestOverrides.size).toBe(1);
      expect(config.allowedRequestOverrides.get('INCLUDE_PROJECT_IDS')).toBe('restricted');
    });

    it('should allow site overrides to clear allowed request overrides with empty string', () => {
      vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', '*');
      vi.stubEnv('ALLOW_SITES_TO_CONFIGURE_REQUEST_OVERRIDES', 'true');

      const config = new OverridableConfig({
        ALLOWED_REQUEST_OVERRIDES: '',
      });

      expect(config.allowedRequestOverrides.size).toBe(0);
    });
  });

  describe('Request overrides', () => {
    describe('bounded context', () => {
      it('should apply INCLUDE_PROJECT_IDS request override when allowed', () => {
        vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'INCLUDE_PROJECT_IDS:unrestricted');

        const config = new OverridableConfig({}, { INCLUDE_PROJECT_IDS: 'p1,p2' });
        expect(config.boundedContext.projectIds).toEqual(new Set(['p1', 'p2']));
      });

      it('should throw when INCLUDE_PROJECT_IDS request override is not allowed', () => {
        expect(() => new OverridableConfig({}, { INCLUDE_PROJECT_IDS: 'p1' })).toThrow(
          'INCLUDE_PROJECT_IDS is not an allowed request override',
        );
      });

      it('should restrict INCLUDE_PROJECT_IDS to a subset of current bounds', () => {
        vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'INCLUDE_PROJECT_IDS');
        vi.stubEnv('INCLUDE_PROJECT_IDS', 'p1,p2,p3');

        const config = new OverridableConfig({}, { INCLUDE_PROJECT_IDS: 'p1,p2' });
        expect(config.boundedContext.projectIds).toEqual(new Set(['p1', 'p2']));
      });

      it('should throw when restricted INCLUDE_PROJECT_IDS override is not a subset of current bounds', () => {
        vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'INCLUDE_PROJECT_IDS');
        vi.stubEnv('INCLUDE_PROJECT_IDS', 'p1,p2');

        expect(() => new OverridableConfig({}, { INCLUDE_PROJECT_IDS: 'p1,p99' })).toThrow(
          'INCLUDE_PROJECT_IDS can only be overridden to a subset of the current bounds',
        );
      });

      it('should allow unrestricted INCLUDE_PROJECT_IDS to set any bounds', () => {
        vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'INCLUDE_PROJECT_IDS:unrestricted');
        vi.stubEnv('INCLUDE_PROJECT_IDS', 'p1');

        const config = new OverridableConfig({}, { INCLUDE_PROJECT_IDS: 'p2,p99' });
        expect(config.boundedContext.projectIds).toEqual(new Set(['p2', 'p99']));
      });

      it('should throw when restricted INCLUDE_PROJECT_IDS tries to clear bounds', () => {
        vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'INCLUDE_PROJECT_IDS');
        vi.stubEnv('INCLUDE_PROJECT_IDS', 'p1');

        expect(() => new OverridableConfig({}, { INCLUDE_PROJECT_IDS: '' })).toThrow(
          'INCLUDE_PROJECT_IDS is restricted and cannot be cleared',
        );
      });

      it('should allow unrestricted INCLUDE_PROJECT_IDS to clear bounds', () => {
        vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'INCLUDE_PROJECT_IDS:unrestricted');
        vi.stubEnv('INCLUDE_PROJECT_IDS', 'p1');

        const config = new OverridableConfig({}, { INCLUDE_PROJECT_IDS: '' });
        expect(config.boundedContext.projectIds).toBeNull();
      });

      it('should set project IDs when no current bounds exist and override is provided', () => {
        vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'INCLUDE_PROJECT_IDS');

        const config = new OverridableConfig({}, { INCLUDE_PROJECT_IDS: 'p1,p2' });
        expect(config.boundedContext.projectIds).toEqual(new Set(['p1', 'p2']));
      });

      it('should leave project IDs null when no current bounds and override is empty', () => {
        vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'INCLUDE_PROJECT_IDS');

        const config = new OverridableConfig({}, { INCLUDE_PROJECT_IDS: '' });
        expect(config.boundedContext.projectIds).toBeNull();
      });

      it('should throw when INCLUDE_DATASOURCE_IDS request override is not allowed', () => {
        expect(() => new OverridableConfig({}, { INCLUDE_DATASOURCE_IDS: 'd1' })).toThrow(
          'INCLUDE_DATASOURCE_IDS is not an allowed request override',
        );
      });

      it('should apply INCLUDE_DATASOURCE_IDS request override when allowed', () => {
        vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'INCLUDE_DATASOURCE_IDS:unrestricted');

        const config = new OverridableConfig({}, { INCLUDE_DATASOURCE_IDS: 'd1,d2' });
        expect(config.boundedContext.datasourceIds).toEqual(new Set(['d1', 'd2']));
      });

      it('should throw when INCLUDE_WORKBOOK_IDS request override is not allowed', () => {
        expect(() => new OverridableConfig({}, { INCLUDE_WORKBOOK_IDS: 'w1' })).toThrow(
          'INCLUDE_WORKBOOK_IDS is not an allowed request override',
        );
      });

      it('should apply INCLUDE_WORKBOOK_IDS request override when allowed', () => {
        vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'INCLUDE_WORKBOOK_IDS:unrestricted');

        const config = new OverridableConfig({}, { INCLUDE_WORKBOOK_IDS: 'w1,w2' });
        expect(config.boundedContext.workbookIds).toEqual(new Set(['w1', 'w2']));
      });

      it('should throw when INCLUDE_TAGS request override is not allowed', () => {
        expect(() => new OverridableConfig({}, { INCLUDE_TAGS: 'tag1' })).toThrow(
          'INCLUDE_TAGS is not an allowed request override',
        );
      });

      it('should apply INCLUDE_TAGS request override when allowed', () => {
        vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'INCLUDE_TAGS:unrestricted');

        const config = new OverridableConfig({}, { INCLUDE_TAGS: 'tag1,tag2' });
        expect(config.boundedContext.tags).toEqual(new Set(['tag1', 'tag2']));
      });
    });

    describe('boolean variables', () => {
      it('should apply DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS request override when allowed', () => {
        vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS');

        const config = new OverridableConfig(
          {},
          { DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS: 'true' },
        );
        expect(config.disableQueryDatasourceValidationRequests).toBe(true);
      });

      it('should throw when DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS request override is not allowed', () => {
        expect(
          () => new OverridableConfig({}, { DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS: 'true' }),
        ).toThrow(
          'DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS is not an allowed request override',
        );
      });

      it('should throw when restricted boolean override violates allowed value', () => {
        vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS');

        expect(
          () =>
            new OverridableConfig({}, { DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS: 'false' }),
        ).toThrow(
          'DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS is restricted and can only be overridden to true',
        );
      });

      it('should allow unrestricted boolean override to be set to any valid value', () => {
        vi.stubEnv(
          'ALLOWED_REQUEST_OVERRIDES',
          'DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS:unrestricted',
        );
        vi.stubEnv('DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS', 'true');

        const config = new OverridableConfig(
          {},
          { DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS: 'false' },
        );
        expect(config.disableQueryDatasourceValidationRequests).toBe(false);
      });

      it('should throw when boolean request override has an invalid value', () => {
        vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'DISABLE_METADATA_API_REQUESTS:unrestricted');

        expect(
          () => new OverridableConfig({}, { DISABLE_METADATA_API_REQUESTS: 'notbool' }),
        ).toThrow('DISABLE_METADATA_API_REQUESTS was provided an invalid request override value');
      });
    });

    describe('MAX_RESULT_LIMIT', () => {
      it('should apply MAX_RESULT_LIMIT request override when allowed', () => {
        vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'MAX_RESULT_LIMIT:unrestricted');

        const config = new OverridableConfig({}, { MAX_RESULT_LIMIT: '50' });
        expect(config.getMaxResultLimit('query-datasource')).toBe(50);
      });

      it('should throw when MAX_RESULT_LIMIT request override is not allowed', () => {
        expect(() => new OverridableConfig({}, { MAX_RESULT_LIMIT: '50' })).toThrow(
          'MAX_RESULT_LIMIT is not an allowed request override',
        );
      });

      it('should restrict MAX_RESULT_LIMIT override to values less than current limit', () => {
        vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'MAX_RESULT_LIMIT');
        vi.stubEnv('MAX_RESULT_LIMIT', '100');

        const config = new OverridableConfig({}, { MAX_RESULT_LIMIT: '50' });
        expect(config.getMaxResultLimit('query-datasource')).toBe(50);
      });

      it('should throw when restricted MAX_RESULT_LIMIT override exceeds current limit', () => {
        vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'MAX_RESULT_LIMIT');
        vi.stubEnv('MAX_RESULT_LIMIT', '100');

        expect(() => new OverridableConfig({}, { MAX_RESULT_LIMIT: '200' })).toThrow(
          'MAX_RESULT_LIMIT is restricted and can only be overriden to values less than 100',
        );
      });

      it('should throw when restricted MAX_RESULT_LIMIT override tries to clear the limit', () => {
        vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'MAX_RESULT_LIMIT');
        vi.stubEnv('MAX_RESULT_LIMIT', '100');

        expect(() => new OverridableConfig({}, { MAX_RESULT_LIMIT: '' })).toThrow(
          'MAX_RESULT_LIMIT is restricted and cannot be cleared',
        );
      });

      it('should throw when MAX_RESULT_LIMIT override is invalid', () => {
        vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'MAX_RESULT_LIMIT:unrestricted');

        expect(() => new OverridableConfig({}, { MAX_RESULT_LIMIT: '-5' })).toThrow(
          'MAX_RESULT_LIMIT was provided an invalid request override value',
        );
      });
    });

    describe('MAX_RESULT_LIMITS', () => {
      it('should apply MAX_RESULT_LIMITS request override when unrestricted', () => {
        vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'MAX_RESULT_LIMITS:unrestricted');

        const config = new OverridableConfig({}, { MAX_RESULT_LIMITS: 'query-datasource:50' });
        expect(config.getMaxResultLimit('query-datasource')).toBe(50);
      });

      it('should throw when MAX_RESULT_LIMITS request override is not allowed', () => {
        expect(
          () => new OverridableConfig({}, { MAX_RESULT_LIMITS: 'query-datasource:50' }),
        ).toThrow('MAX_RESULT_LIMITS is not an allowed request override');
      });

      it('should throw when unrestricted MAX_RESULT_LIMITS override is invalid', () => {
        vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'MAX_RESULT_LIMITS:unrestricted');

        expect(() => new OverridableConfig({}, { MAX_RESULT_LIMITS: 'invalid' })).toThrow(
          'MAX_RESULT_LIMITS was provided an invalid request override value',
        );
      });

      it('should restrict MAX_RESULT_LIMITS override per-tool to current limits', () => {
        vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'MAX_RESULT_LIMITS');
        vi.stubEnv('MAX_RESULT_LIMITS', 'query-datasource:100');

        const config = new OverridableConfig({}, { MAX_RESULT_LIMITS: 'query-datasource:50' });
        expect(config.getMaxResultLimit('query-datasource')).toBe(50);
      });

      it('should throw when restricted MAX_RESULT_LIMITS override exceeds current tool limit', () => {
        vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'MAX_RESULT_LIMITS');
        vi.stubEnv('MAX_RESULT_LIMITS', 'query-datasource:100');

        expect(
          () => new OverridableConfig({}, { MAX_RESULT_LIMITS: 'query-datasource:200' }),
        ).toThrow(
          'MAX_RESULT_LIMITS request override must include a limit for query-datasource that is less than or equal to 100',
        );
      });
    });
  });
});
