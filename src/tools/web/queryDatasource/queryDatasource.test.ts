import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodiosError } from '@zodios/core';
import { Err, Ok } from 'ts-results-es';

import * as activityLogModule from '../../../activityLog/init.js';
import { McpToolError, WorkbookDatasourceNotEnabledError } from '../../../errors/mcpToolError.js';
import * as loggerModule from '../../../logging/logger.js';
import { Query, queryOutputSchema } from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { ProductVersion } from '../../../sdks/tableau/types/serverInfo.js';
import { WebMcpServer } from '../../../server.web.js';
import {
  stubDefaultEnvVars,
  testProductVersion,
  testProductVersion2025_3,
} from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import {
  getEmbeddedDatasourceVersionHint,
  getVizqlDataServiceDisabledError,
} from '../getVizqlDataServiceDisabledError.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { exportedForTesting as datasourceCredentialsExportedForTesting } from './datasourceCredentials.js';
import { getQueryDatasourceTool } from './queryDatasource.js';

const { resetDatasourceCredentials } = datasourceCredentialsExportedForTesting;
const { resetResourceAccessCheckerSingleton } = resourceAccessCheckerExportedForTesting;

const mockVdsResponses = vi.hoisted(() => ({
  success: {
    data: [
      {
        Category: 'Technology',
        'SUM(Profit)': 146543.37559999965,
      },
      {
        Category: 'Furniture',
        'SUM(Profit)': 19729.995600000024,
      },
      {
        Category: 'Office Supplies',
        'SUM(Profit)': 126023.44340000013,
      },
    ],
  },
  error: {
    errorCode: '400803',
    message: 'Unknown Field: Foobar.',
    datetime: '2024-06-19T17:51:36.4771244Z',
    debug: {
      details: {
        detail: 'Error in query, Unknown Field: Foobar.',
      },
    },
  },
}));

const mocks = vi.hoisted(() => ({
  mockQueryDatasource: vi.fn(),
  mockReadMetadata: vi.fn(),
  mockRestQueryDatasource: vi.fn(),
  mockQueryWorkbookConnections: vi.fn(),
  mockGetWorkbook: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      signIn: vi.fn(),
      signOut: vi.fn(),
      siteId: 'test-site-id',
      vizqlDataServiceMethods: {
        queryDatasource: mocks.mockQueryDatasource,
        readMetadata: mocks.mockReadMetadata,
      },
      datasourcesMethods: {
        queryDatasource: mocks.mockRestQueryDatasource,
      },
      workbooksMethods: {
        queryWorkbookConnections: mocks.mockQueryWorkbookConnections,
        getWorkbook: mocks.mockGetWorkbook,
      },
    }),
  ),
}));

beforeEach(() => {
  vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
});

describe('queryDatasourceTool', () => {
  const originalVersionIsAtLeast = RestApi.versionIsAtLeast;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockReadMetadata.mockReset();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    resetDatasourceCredentials();
    resetResourceAccessCheckerSingleton();
    // Default to a version that supports embedded queries so existing tests see the base messages;
    // the version-hint tests override this per-test. (RestApi is globally mocked in testSetup, so
    // versionIsAtLeast is stubbed rather than derived from RestApi.version — see getViewData.test.)
    RestApi.versionIsAtLeast = vi.fn().mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    RestApi.versionIsAtLeast = originalVersionIsAtLeast;
  });

  it('should create a tool instance with correct properties', () => {
    const queryDatasourceTool = getQueryDatasourceTool(new WebMcpServer(), testProductVersion);
    expect(queryDatasourceTool.name).toBe('query-datasource');
    expect(queryDatasourceTool.description).toBeInstanceOf(Provider);
    expect(queryDatasourceTool.paramsSchema).not.toBeUndefined();
  });

  it('should bound limit so that limit + 1 fits in a 32-bit int', async () => {
    const queryDatasourceTool = getQueryDatasourceTool(new WebMcpServer(), testProductVersion);
    const schema = await Provider.from(queryDatasourceTool.paramsSchema);
    const base = {
      datasourceLuid: '71db762b-6201-466b-93da-57cc0aec8ed9',
      query: { fields: [{ fieldCaption: 'Category' }] },
    };

    expect(schema.safeParse({ ...base, limit: 2147483646 }).success).toBe(true);
    expect(schema.safeParse({ ...base, limit: 2147483647 }).success).toBe(false);
  });

  it.each([testProductVersion2025_3, testProductVersion])(
    'validates and forwards internal field names only when requested on $value',
    async (productVersion) => {
      mocks.mockReadMetadata.mockResolvedValue(
        Ok({ data: [{ fieldCaption: 'Margin', fieldName: 'Calculation_1003', dataType: 'REAL' }] }),
      );
      mocks.mockQueryDatasource.mockResolvedValue(Ok(mockVdsResponses.success));
      const query: Query = { fields: [{ fieldCaption: 'Calculation_1003', function: 'AVG' }] };
      const result = await getToolResult({
        query,
        productVersion,
        interpretFieldCaptionsAsFieldNames: true,
      });
      expect(result.isError).toBe(false);
      expect(mocks.mockQueryDatasource).toHaveBeenCalledWith(
        expect.objectContaining({
          query,
          options: expect.objectContaining({ interpretFieldCaptionsAsFieldNames: true }),
        }),
      );
      mocks.mockQueryDatasource.mockClear();
      const rejected = await getToolResult({ query, productVersion });
      expect(rejected.isError).toBe(true);
      expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
    },
  );

  it('forwards internal field and parameter references in calculations with a caller-chosen label', async () => {
    mocks.mockReadMetadata.mockResolvedValue(
      Ok({
        data: [{ fieldCaption: 'Staffing Cost', fieldName: 'staffing_cost', dataType: 'REAL' }],
        extraData: {
          parameters: [
            {
              parameterCaption: 'Multiplier',
              parameterName: 'Parameter 1',
              parameterType: 'ANY_VALUE',
              dataType: 'REAL',
              value: 1,
            },
          ],
        },
      }),
    );
    mocks.mockQueryDatasource.mockResolvedValue(Ok({ data: [{ 'Adjusted staffing cost': 200 }] }));
    const query: Query = {
      fields: [
        {
          fieldCaption: 'Adjusted staffing cost',
          calculation: 'SUM([staffing_cost]) * [Parameter 1]',
        },
      ],
      parameters: [{ parameterCaption: 'Parameter 1', value: 2 }],
    };

    const result = await getToolResult({ query, interpretFieldCaptionsAsFieldNames: true });

    expect(result.isError).toBe(false);
    expect(mocks.mockQueryDatasource).toHaveBeenCalledWith(
      expect.objectContaining({
        query,
        options: expect.objectContaining({ interpretFieldCaptionsAsFieldNames: true }),
      }),
    );
  });

  it.each([
    [{ value: '2025.2.9', build: '20252.25.1001.1200' }, false],
    [testProductVersion2025_3, true],
  ] as const)(
    'advertises name mode according to version %s over MCP',
    async (productVersion, supported) => {
      const { McpServer } = await vi.importActual<
        typeof import('@modelcontextprotocol/sdk/server/mcp.js')
      >('@modelcontextprotocol/sdk/server/mcp.js');
      const server = new McpServer({ name: 'test', version: '0.0.0' });
      const tool = getQueryDatasourceTool(new WebMcpServer(), productVersion);
      const callback = await Provider.from(tool.callback);
      server.registerTool(
        tool.name,
        { inputSchema: await Provider.from(tool.paramsSchema) },
        (args) => callback(args, getMockRequestHandlerExtra()),
      );
      const client = new Client({ name: 'test-client', version: '0.0.0' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      mocks.mockReadMetadata.mockResolvedValue(
        Ok({
          data: [
            { fieldCaption: 'Margin', fieldName: 'Calculation_1003', dataType: 'REAL' },
            { fieldCaption: 'Category', fieldName: 'Category', dataType: 'STRING' },
          ],
        }),
      );
      mocks.mockQueryDatasource.mockResolvedValue(Ok(mockVdsResponses.success));
      try {
        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
        const { tools } = await client.listTools();
        expect(
          Object.hasOwn(
            tools[0].inputSchema.properties ?? {},
            'interpretFieldCaptionsAsFieldNames',
          ),
        ).toBe(supported);
        expect(tools[0].inputSchema.properties).toHaveProperty('datasourceLuid');
        expect(tools[0].inputSchema.properties).toHaveProperty('query');
        const args = {
          datasourceLuid: '71db762b-6201-466b-93da-57cc0aec8ed9',
          query: { fields: [{ fieldCaption: 'Calculation_1003', function: 'AVG' }] },
          interpretFieldCaptionsAsFieldNames: true,
        };
        const result = await client.callTool({ name: tool.name, arguments: args });
        expect(result.isError).toBe(!supported);
        if (supported) {
          expect(mocks.mockQueryDatasource).toHaveBeenCalledWith(
            expect.objectContaining({
              options: expect.objectContaining({ interpretFieldCaptionsAsFieldNames: true }),
            }),
          );
        } else {
          expect(result).toMatchObject({
            content: [{ text: expect.stringContaining('requires Tableau 2025.3 or later') }],
          });
          expect(mocks.mockReadMetadata).not.toHaveBeenCalled();
          expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
        }
        const captionResult = await client.callTool({
          name: tool.name,
          arguments: {
            datasourceLuid: args.datasourceLuid,
            query: { fields: [{ fieldCaption: 'Category' }] },
          },
        });
        expect(captionResult.isError).toBe(false);
        expect(mocks.mockQueryDatasource.mock.lastCall?.[0].options).not.toHaveProperty(
          'interpretFieldCaptionsAsFieldNames',
        );
      } finally {
        await client.close();
        await server.close();
      }
    },
  );

  describe('version-gated query features', () => {
    const productVersion2025_2 = { value: '2025.2.9', build: '20252.25.1001.1200' };
    const tableCalcQuery: Query = {
      fields: [
        { fieldCaption: 'Category' },
        {
          fieldCaption: 'Sales',
          function: 'SUM',
          tableCalculation: { tableCalcType: 'RANK', dimensions: [{ fieldCaption: 'Category' }] },
        },
      ],
    };
    const conditionQuery: Query = {
      fields: [{ fieldCaption: 'Category' }, { fieldCaption: 'Sales', function: 'SUM' }],
      filters: [
        {
          field: { fieldCaption: 'Category' },
          filterType: 'CONDITION',
          condition: { fieldCaption: 'Sales', function: 'SUM', comparison: '>', value: 1000 },
        },
      ],
    };
    const setFilterWithFunctionQuery: Query = {
      fields: [{ fieldCaption: 'Category' }],
      filters: [
        {
          field: { fieldCaption: 'Order Date', function: 'YEAR' },
          filterType: 'SET',
          values: [2024],
        },
      ],
    };

    beforeEach(() => {
      mocks.mockReadMetadata.mockResolvedValue(
        Ok({
          data: [
            { fieldCaption: 'Category', fieldName: 'Category', dataType: 'STRING' },
            { fieldCaption: 'Sales', fieldName: 'Sales', dataType: 'REAL' },
            { fieldCaption: 'Order Date', fieldName: 'Order Date', dataType: 'DATE' },
          ],
        }),
      );
      mocks.mockQueryDatasource.mockResolvedValue(Ok(mockVdsResponses.success));
    });

    it.each([
      {
        feature: 'table calculations',
        query: tableCalcQuery,
        version: productVersion2025_2,
        message: 'Tableau 2025.3 or later',
      },
      {
        feature: 'CONDITION filters',
        query: conditionQuery,
        version: productVersion2025_2,
        message: 'Tableau 2026.1 or later',
      },
      {
        feature: 'CONDITION filters',
        query: conditionQuery,
        version: testProductVersion2025_3,
        message: 'Tableau 2026.1 or later',
      },
      {
        feature: 'functions in SET filters',
        query: setFilterWithFunctionQuery,
        version: testProductVersion2025_3,
        message: 'must not include Set Filters, Match Filters, or Relative Date Filters',
      },
    ])('rejects $feature on $version.value', async ({ query, version, message }) => {
      const result = await getToolResult({ query, productVersion: version });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(message);
      expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
    });

    it.each([
      { feature: 'table calculations', query: tableCalcQuery, version: testProductVersion2025_3 },
      { feature: 'table calculations', query: tableCalcQuery, version: testProductVersion },
      { feature: 'CONDITION filters', query: conditionQuery, version: testProductVersion },
      {
        feature: 'functions in SET filters',
        query: setFilterWithFunctionQuery,
        version: testProductVersion,
      },
    ])('sends $feature to VDS on $version.value', async ({ query, version }) => {
      const result = await getToolResult({ query, productVersion: version });

      expect(result.isError).toBe(false);
      expect(mocks.mockQueryDatasource).toHaveBeenCalledWith(expect.objectContaining({ query }));
    });
  });

  describe('field-name queries on Tableau 2025.2', () => {
    const productVersion = { value: '2025.2.9', build: '20252.25.1001.1200' };

    it.each(['false', 'true'])(
      'rejects name mode with validation disabled=%s',
      async (disabled) => {
        vi.stubEnv('DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS', disabled);
        const result = await getToolResult({
          productVersion,
          interpretFieldCaptionsAsFieldNames: true,
        });

        expect(result.isError).toBe(true);
        invariant(result.content[0].type === 'text');
        expect(result.content[0].text).toContain('requires Tableau 2025.3 or later');
        expect(mocks.mockReadMetadata).not.toHaveBeenCalled();
        expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
      },
    );

    it.each([undefined, false])('preserves caption queries when name mode is %s', async (mode) => {
      mocks.mockQueryDatasource.mockResolvedValue(Ok(mockVdsResponses.success));
      const result = await getToolResult({
        productVersion,
        interpretFieldCaptionsAsFieldNames: mode,
      });

      expect(result.isError).toBe(false);
      expect(mocks.mockQueryDatasource).toHaveBeenCalledWith({
        datasource: { datasourceLuid: '71db762b-6201-466b-93da-57cc0aec8ed9' },
        query: {
          fields: [
            { fieldCaption: 'Category' },
            { fieldCaption: 'Profit', function: 'SUM', sortDirection: 'DESC' },
          ],
        },
        options: { debug: true, disaggregate: false, returnFormat: 'OBJECTS' },
      });
    });
  });

  it('should return error when query args fail validation', async () => {
    const queryDatasourceTool = getQueryDatasourceTool(new WebMcpServer(), testProductVersion);
    const callback = await Provider.from(queryDatasourceTool.callback);

    const result = await callback(
      {
        datasourceLuid: '',
        query: { fields: [{ fieldCaption: 'Category' }] },
        workbookLuid: undefined,
        limit: undefined,
        interpretFieldCaptionsAsFieldNames: undefined,
      },
      getMockRequestHandlerExtra(),
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe('datasourceLuid must be a non-empty string.');
    expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
  });

  it('should successfully query the datasource', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(new Ok(mockVdsResponses.success));

    const result = await getToolResult();

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual(mockVdsResponses.success);
    expect(mocks.mockQueryDatasource).toHaveBeenCalledWith({
      datasource: {
        datasourceLuid: '71db762b-6201-466b-93da-57cc0aec8ed9',
      },
      options: {
        debug: true,
        disaggregate: false,
        returnFormat: 'OBJECTS',
      },
      query: {
        fields: [
          {
            fieldCaption: 'Category',
          },
          {
            fieldCaption: 'Profit',
            function: 'SUM',
            sortDirection: 'DESC',
          },
        ],
      },
    });
  });

  it('should successfully query the datasource with a limit', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(new Ok(mockVdsResponses.success));

    const result = await getToolResult({ limit: 100 });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual({
      ...mockVdsResponses.success,
      mcp: { resultInfo: { returnedCount: 3, truncated: false } },
    });
    expect(mocks.mockQueryDatasource).toHaveBeenCalledWith({
      datasource: {
        datasourceLuid: '71db762b-6201-466b-93da-57cc0aec8ed9',
      },
      options: {
        debug: true,
        disaggregate: false,
        returnFormat: 'OBJECTS',
        rowLimit: 101,
      },
      query: {
        fields: [
          {
            fieldCaption: 'Category',
          },
          {
            fieldCaption: 'Profit',
            function: 'SUM',
            sortDirection: 'DESC',
          },
        ],
      },
    });
  });

  it('should not query the datasource with a limit on 2025.3 or earlier', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(new Ok(mockVdsResponses.success));

    const result = await getToolResult({ limit: 100, productVersion: testProductVersion2025_3 });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual({
      ...mockVdsResponses.success,
      mcp: { resultInfo: { returnedCount: 3, truncated: false } },
    });
    expect(mocks.mockQueryDatasource).toHaveBeenCalledWith({
      datasource: {
        datasourceLuid: '71db762b-6201-466b-93da-57cc0aec8ed9',
      },
      options: {
        debug: true,
        disaggregate: false,
        returnFormat: 'OBJECTS',
      },
      query: {
        fields: [
          {
            fieldCaption: 'Category',
          },
          {
            fieldCaption: 'Profit',
            function: 'SUM',
            sortDirection: 'DESC',
          },
        ],
      },
    });
  });

  describe('row limit truncation', () => {
    const rows = (n: number): { data: Array<Record<string, unknown>> } => ({
      data: Array.from({ length: n }, (_, i) => ({ Category: `C${i}`, 'SUM(Profit)': i })),
    });

    async function getParsed(args: Parameters<typeof getToolResult>[0]): Promise<any> {
      const result = await getToolResult(args);
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      return JSON.parse(result.content[0].text);
    }

    it('should report admin-cap truncation and trim to the cap', async () => {
      vi.stubEnv('MAX_RESULT_LIMIT', '2');
      mocks.mockQueryDatasource.mockResolvedValue(new Ok(rows(3)));

      const parsed = await getParsed({});

      expect(mocks.mockQueryDatasource.mock.calls[0][0].options.rowLimit).toBe(3);
      expect(parsed.data).toHaveLength(2);
      expect(parsed.mcp).toEqual({
        resultInfo: { returnedCount: 2, truncated: true, truncationReason: 'admin-cap' },
      });
    });

    it('should keep the requested rowLimit within int32 for a maximal cap', async () => {
      vi.stubEnv('MAX_RESULT_LIMIT', '2147483647');
      mocks.mockQueryDatasource.mockResolvedValue(new Ok(rows(3)));

      await getParsed({});

      expect(mocks.mockQueryDatasource.mock.calls[0][0].options.rowLimit).toBe(2147483647);
    });

    it('should not report truncation when exactly the limit rows match', async () => {
      vi.stubEnv('MAX_RESULT_LIMIT', '3');
      mocks.mockQueryDatasource.mockResolvedValue(new Ok(rows(3)));

      const parsed = await getParsed({});

      expect(parsed.data).toHaveLength(3);
      expect(parsed.mcp).toEqual({ resultInfo: { returnedCount: 3, truncated: false } });
    });

    it('should report requested-limit when the caller limit binds under a larger cap', async () => {
      vi.stubEnv('MAX_RESULT_LIMIT', '10');
      mocks.mockQueryDatasource.mockResolvedValue(new Ok(rows(3)));

      const parsed = await getParsed({ limit: 2 });

      expect(mocks.mockQueryDatasource.mock.calls[0][0].options.rowLimit).toBe(3);
      expect(parsed.data).toHaveLength(2);
      expect(parsed.mcp).toEqual({
        resultInfo: { returnedCount: 2, truncated: true, truncationReason: 'requested-limit' },
      });
    });

    it('should send no rowLimit and no mcp key when no limit or cap applies', async () => {
      mocks.mockQueryDatasource.mockResolvedValue(new Ok(mockVdsResponses.success));

      const parsed = await getParsed({});

      expect(mocks.mockQueryDatasource.mock.calls[0][0].options).not.toHaveProperty('rowLimit');
      expect(parsed).toEqual(mockVdsResponses.success);
      expect(parsed).not.toHaveProperty('mcp');
    });

    it('should return context warnings and resultInfo together', async () => {
      vi.stubEnv('DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS', 'true');
      mocks.mockQueryDatasource.mockResolvedValue(new Ok(mockVdsResponses.success));

      const parsed = await getParsed({
        limit: 100,
        query: {
          fields: [{ fieldCaption: 'Category' }, { fieldCaption: 'Profit', function: 'SUM' }],
          filters: [
            {
              field: { fieldCaption: 'Category' },
              filterType: 'TOP',
              howMany: 2,
              direction: 'TOP',
              fieldToMeasure: { fieldCaption: 'Profit', function: 'SUM' },
            },
            {
              field: { fieldCaption: 'Region' },
              filterType: 'SET',
              values: ['East'],
              exclude: false,
            },
          ],
        },
      });

      expect(parsed.mcp.warnings).toHaveLength(1);
      expect(parsed.mcp.warnings[0].type).toBe('MISSING_CONTEXT_ON_DIMENSION_FILTER');
      expect(parsed.mcp.resultInfo).toEqual({ returnedCount: 3, truncated: false });
    });

    it('should trim and report admin-cap on versions that cannot send a rowLimit', async () => {
      vi.stubEnv('MAX_RESULT_LIMIT', '2');
      mocks.mockQueryDatasource.mockResolvedValue(new Ok(rows(3)));

      const parsed = await getParsed({ productVersion: testProductVersion2025_3 });

      expect(mocks.mockQueryDatasource.mock.calls[0][0].options).not.toHaveProperty('rowLimit');
      expect(parsed.data).toHaveLength(2);
      expect(parsed.mcp).toEqual({
        resultInfo: { returnedCount: 2, truncated: true, truncationReason: 'admin-cap' },
      });
    });
  });

  it('should return a successful result when the VDS response contains a schema validation error', async () => {
    const badResponse = {
      ...mockVdsResponses.success,
      data: 'hamburgers',
    };

    mocks.mockQueryDatasource.mockImplementation(() => {
      const zodiosError = new ZodiosError(
        'Zodios: Invalid response from endpoint',
        undefined,
        badResponse,
        queryOutputSchema.safeParse(badResponse).error,
      );

      return new Err({ type: 'zodios-error', error: zodiosError });
    });

    const result = await getToolResult();

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual({
      data: badResponse.toString(),
      warning: 'Validation error: Expected array, received string at "data"',
    });
  });

  it('should add datasource credentials to the request when provided', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(new Ok(mockVdsResponses.success));
    vi.stubEnv(
      'DATASOURCE_CREDENTIALS',
      JSON.stringify({
        '71db762b-6201-466b-93da-57cc0aec8ed9': [
          { luid: 'test-luid', u: 'test-user', p: 'test-pass' },
        ],
      }),
    );

    const result = await getToolResult();
    expect(result.isError).toBe(false);

    expect(mocks.mockQueryDatasource).toHaveBeenCalledWith({
      datasource: {
        datasourceLuid: '71db762b-6201-466b-93da-57cc0aec8ed9',
        connections: [
          {
            connectionLuid: 'test-luid',
            connectionUsername: 'test-user',
            connectionPassword: 'test-pass',
          },
        ],
      },
      options: {
        debug: true,
        disaggregate: false,
        returnFormat: 'OBJECTS',
      },
      query: {
        fields: [
          {
            fieldCaption: 'Category',
          },
          {
            fieldCaption: 'Profit',
            function: 'SUM',
            sortDirection: 'DESC',
          },
        ],
      },
    });
  });

  it('should return error when VDS returns an error', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(
      new McpToolError({
        type: 'tableau-error',
        message: mockVdsResponses.error.message,
        statusCode: 400,
      }).toErr(),
    );

    const result = await getToolResult();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe('Unknown Field: Foobar.');
    expect(mocks.mockQueryDatasource).toHaveBeenCalledWith({
      datasource: {
        datasourceLuid: '71db762b-6201-466b-93da-57cc0aec8ed9',
      },
      options: {
        debug: true,
        disaggregate: false,
        returnFormat: 'OBJECTS',
      },
      query: {
        fields: [
          {
            fieldCaption: 'Category',
          },
          {
            fieldCaption: 'Profit',
            function: 'SUM',
            sortDirection: 'DESC',
          },
        ],
      },
    });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockQueryDatasource.mockRejectedValue(new Error(errorMessage));

    const result = await getToolResult();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe('requestId: 2, error: API Error');
  });

  describe('Filter Validation', () => {
    it('should return validation error for SET filter with invalid values and suggest fuzzy matches', async () => {
      // Mock main query to return empty results (triggering validation)
      mocks.mockQueryDatasource
        // Mock validation query to return existing values
        .mockResolvedValueOnce(
          new Ok({
            data: [
              { DistinctValues: 'East' },
              { DistinctValues: 'West' },
              { DistinctValues: 'North' },
              { DistinctValues: 'South' },
              { DistinctValues: 'Central' },
            ],
          }),
        );
      const queryDatasourceTool = getQueryDatasourceTool(new WebMcpServer(), testProductVersion);
      const callback = await Provider.from(queryDatasourceTool.callback);
      const result = await callback(
        {
          datasourceLuid: 'test-datasource-luid',
          query: {
            fields: [{ fieldCaption: 'Sales', function: 'SUM' }],
            filters: [
              {
                field: { fieldCaption: 'Region' },
                filterType: 'SET',
                values: ['East', 'Wast'], // 'Wast' is a typo for 'West'
              },
            ],
          },
          workbookLuid: undefined,
          limit: undefined,
          interpretFieldCaptionsAsFieldNames: undefined,
        },
        getMockRequestHandlerExtra(),
      );

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      const errorResponse = result.content[0].text;
      expect(errorResponse).toContain('Filter validation failed for field "Region"');
      expect(errorResponse).toContain('Wast');
      expect(errorResponse).toContain('Did you mean:');
      expect(errorResponse).toContain('West'); // Should suggest fuzzy match

      // Should call only the validation query & error on invalid values
      expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(1);
    });

    it('should return validation error for MATCH filter with invalid pattern and suggest similar values', async () => {
      // Mock main query to return empty results (triggering validation)
      mocks.mockQueryDatasource
        // Mock validation query to return sample values that don't match exactly but are similar
        .mockResolvedValueOnce(
          new Ok({
            data: [
              { SampleValues: 'John Doe' },
              { SampleValues: 'Jane Smith' },
              { SampleValues: 'Bob Wilson' },
              { SampleValues: 'Alice Brown' },
              { SampleValues: 'Charlie Davis' },
            ],
          }),
        );
      const queryDatasourceTool = getQueryDatasourceTool(new WebMcpServer(), testProductVersion);
      const callback = await Provider.from(queryDatasourceTool.callback);
      const result = await callback(
        {
          datasourceLuid: 'test-datasource-luid',
          query: {
            fields: [{ fieldCaption: 'Sales', function: 'SUM' }],
            filters: [
              {
                field: { fieldCaption: 'Customer Name' },
                filterType: 'MATCH',
                startsWith: 'Jon', // Similar to 'John' but no exact matches
              },
            ],
          },
          workbookLuid: undefined,
          limit: undefined,
          interpretFieldCaptionsAsFieldNames: undefined,
        },
        getMockRequestHandlerExtra(),
      );

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      const errorResponse = result.content[0].text;
      expect(errorResponse).toContain('Filter validation failed for field "Customer Name"');
      expect(errorResponse).toContain('starts with "Jon"');
      expect(errorResponse).toContain('Similar values in this field:');
      expect(errorResponse).toContain('John Doe'); // Should suggest similar value

      // Should call main query first, then validation query
      expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(1);
    });

    it('should return main query results when no SET/MATCH filters are present', async () => {
      const mockMainQueryResult = {
        data: [{ Region: 'East', 'SUM(Sales)': 100000 }],
      };

      // Mock main query only
      mocks.mockQueryDatasource.mockResolvedValueOnce(new Ok(mockMainQueryResult));

      const queryDatasourceTool = getQueryDatasourceTool(new WebMcpServer(), testProductVersion);
      const callback = await Provider.from(queryDatasourceTool.callback);
      const result = await callback(
        {
          datasourceLuid: 'test-datasource-luid',
          query: {
            fields: [{ fieldCaption: 'Region' }, { fieldCaption: 'Sales', function: 'SUM' }],
            filters: [
              {
                field: { fieldCaption: 'Sales' },
                filterType: 'QUANTITATIVE_NUMERICAL',
                quantitativeFilterType: 'MIN',
                min: 1000,
              },
            ],
          },
          workbookLuid: undefined,
          limit: undefined,
          interpretFieldCaptionsAsFieldNames: undefined,
        },
        getMockRequestHandlerExtra(),
      );

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(JSON.parse(result.content[0].text)).toEqual(mockMainQueryResult);

      // Should only call the main query (no validation needed)
      expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(1);
    });

    it('should not run SET/MATCH filters validation when DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS environment variable is true', async () => {
      vi.stubEnv('DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS', 'true');

      const mockMainQueryResult = {
        data: [{ Region: 'East', 'SUM(Sales)': 100000 }],
      };

      // Mock main query only
      mocks.mockQueryDatasource.mockResolvedValueOnce(new Ok(mockMainQueryResult));

      const queryDatasourceTool = getQueryDatasourceTool(new WebMcpServer(), testProductVersion);
      const callback = await Provider.from(queryDatasourceTool.callback);
      const result = await callback(
        {
          datasourceLuid: 'test-datasource-luid',
          query: {
            fields: [{ fieldCaption: 'Region' }, { fieldCaption: 'Sales', function: 'SUM' }],
            filters: [
              {
                field: { fieldCaption: 'Region' },
                filterType: 'SET',
                values: ['East', 'Wast'],
              },
            ],
          },
          workbookLuid: undefined,
          limit: undefined,
          interpretFieldCaptionsAsFieldNames: undefined,
        },
        getMockRequestHandlerExtra(),
      );

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(JSON.parse(result.content[0].text)).toEqual(mockMainQueryResult);

      // Should only call the main query (no validation needed)
      expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(1);
    });

    it('should return multiple validation errors when multiple filters fail', async () => {
      // Mock main query to return empty results (triggering validation)
      mocks.mockQueryDatasource
        // Mock first validation query (Region field)
        .mockResolvedValueOnce(
          new Ok({
            data: [
              { DistinctValues: 'East' },
              { DistinctValues: 'West' },
              { DistinctValues: 'North' },
              { DistinctValues: 'South' },
            ],
          }),
        )
        // Mock second validation query (Category field)
        .mockResolvedValueOnce(
          new Ok({
            data: [
              { DistinctValues: 'Electronics' },
              { DistinctValues: 'Furniture' },
              { DistinctValues: 'Office Supplies' },
            ],
          }),
        );

      const queryDatasourceTool = getQueryDatasourceTool(new WebMcpServer(), testProductVersion);
      const callback = await Provider.from(queryDatasourceTool.callback);
      const result = await callback(
        {
          datasourceLuid: 'test-datasource-luid',
          query: {
            fields: [{ fieldCaption: 'Sales', function: 'SUM' }],
            filters: [
              {
                field: { fieldCaption: 'Region' },
                filterType: 'SET',
                values: ['InvalidRegion'],
              },
              {
                field: { fieldCaption: 'Category' },
                filterType: 'SET',
                values: ['InvalidCategory'],
              },
            ],
          },
          workbookLuid: undefined,
          limit: undefined,
          interpretFieldCaptionsAsFieldNames: undefined,
        },
        getMockRequestHandlerExtra(),
      );

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      const errorResponse = result.content[0].text;
      expect(errorResponse).toContain('Filter validation failed for field "Region"');
      expect(errorResponse).toContain('Filter validation failed for field "Category"');
      expect(errorResponse).toContain('InvalidRegion');
      expect(errorResponse).toContain('InvalidCategory');

      // Should call main query first, then both validation queries
      expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(2);
    });
  });

  it('should show feature-disabled error when VDS is disabled (REST API >= 3.30, no version hint)', async () => {
    RestApi.versionIsAtLeast = vi.fn().mockReturnValue(true);
    mocks.mockQueryDatasource.mockResolvedValue(Err({ type: 'feature-disabled' }));

    const result = await getToolResult();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    // On >= 3.30 the message is the plain VDS-disabled text, with no embedded-version hint appended.
    expect(result.content[0].text).toBe(getVizqlDataServiceDisabledError());
    expect(result.content[0].text).not.toContain(getEmbeddedDatasourceVersionHint());
  });

  it('should append the embedded-datasource version hint to the feature-disabled error on REST API < 3.30', async () => {
    RestApi.versionIsAtLeast = vi.fn().mockReturnValue(false);
    mocks.mockQueryDatasource.mockResolvedValue(Err({ type: 'feature-disabled' }));

    const result = await getToolResult();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    // The base "enable VDS via TSM" guidance is preserved and the hedged hint is appended.
    expect(result.content[0].text).toContain(getVizqlDataServiceDisabledError());
    expect(result.content[0].text).toContain(getEmbeddedDatasourceVersionHint());
    expect(result.content[0].text).toBe(
      `${getVizqlDataServiceDisabledError()} ${getEmbeddedDatasourceVersionHint()}`,
    );
  });

  it('should surface an actionable message when workbook-datasource querying is not enabled', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(Err({ type: 'workbook-datasource-not-enabled' }));

    const result = await getToolResult();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new WorkbookDatasourceNotEnabledError().getErrorText());
    expect(result.content[0].text).toContain('not enabled on this Tableau site');
    expect(result.content[0].text).toContain('site administrator');
  });

  it('should return data source not allowed error when datasource is not allowed', async () => {
    vi.stubEnv('INCLUDE_DATASOURCE_IDS', 'some-other-datasource-luid');

    const result = await getToolResult();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      [
        'The set of allowed data sources that can be queried is limited by the server configuration.',
        'Querying the datasource with LUID 71db762b-6201-466b-93da-57cc0aec8ed9 is not allowed.',
      ].join(' '),
    );

    expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
  });

  describe('VDS QueryRequest envelope', () => {
    const datasourceLuid = '71db762b-6201-466b-93da-57cc0aec8ed9';
    const productVersion2026_2 = { value: '2026.2.0', build: '20262.26.0512.0900' };
    const query: Query = {
      fields: [{ fieldCaption: 'Category' }, { fieldCaption: 'Profit', function: 'SUM' }],
    };
    const rows = (n: number): { data: Array<Record<string, unknown>> } => ({
      data: Array.from({ length: n }, (_, i) => ({ Category: `C${i}`, 'SUM(Profit)': i })),
    });

    async function getParsed(args: Parameters<typeof getToolResult>[0]): Promise<any> {
      const result = await getToolResult(args);
      invariant(result.content[0].type === 'text');
      expect(result.isError, result.content[0].text).toBe(false);
      return JSON.parse(result.content[0].text);
    }

    beforeEach(() => {
      mocks.mockReadMetadata.mockResolvedValue(
        Ok({
          data: [
            { fieldCaption: 'Category', fieldName: 'Category', dataType: 'STRING' },
            { fieldCaption: 'Profit', fieldName: 'Profit', dataType: 'REAL' },
          ],
        }),
      );
      mocks.mockQueryDatasource.mockResolvedValue(Ok(rows(3)));
    });

    it('runs a pasted QueryRequest with only the envelope LUID', async () => {
      await getParsed({
        datasourceLuid: null,
        query,
        extraArgs: { datasource: { datasourceLuid } },
      });

      expect(mocks.mockQueryDatasource).toHaveBeenCalledWith(
        expect.objectContaining({ datasource: { datasourceLuid }, query }),
      );
    });

    it('forwards the caller options it supports and keeps its own returnFormat and debug', async () => {
      const parsed = await getParsed({
        query,
        productVersion: productVersion2026_2,
        extraArgs: {
          options: {
            disaggregate: true,
            bypassMetadataCache: true,
            withNewSession: true,
            returnFormat: 'ARRAYS',
            debug: false,
          },
        },
      });

      expect(mocks.mockQueryDatasource.mock.calls[0][0].options).toEqual({
        returnFormat: 'OBJECTS',
        debug: true,
        disaggregate: true,
        bypassMetadataCache: true,
        withNewSession: true,
      });
      expect(parsed.mcp.warnings).toEqual([
        expect.objectContaining({
          type: 'IGNORED_REQUEST_PROPERTY',
          affectedProperties: ['options.returnFormat', 'options.debug'],
        }),
      ]);
    });

    it('defaults disaggregate to false', async () => {
      await getParsed({ query, extraArgs: { options: {} } });
      expect(mocks.mockQueryDatasource.mock.calls[0][0].options.disaggregate).toBe(false);
    });

    it('sends bypassMetadataCache and withNewSession to the metadata read', async () => {
      await getParsed({
        query,
        productVersion: productVersion2026_2,
        extraArgs: { options: { bypassMetadataCache: true, withNewSession: true } },
      });

      expect(mocks.mockReadMetadata).toHaveBeenCalledWith({
        datasource: { datasourceLuid },
        options: { bypassMetadataCache: true, withNewSession: true },
      });
    });

    describe('withNewSession and the validation reads', () => {
      const newFieldQuery: Query = {
        fields: [{ fieldCaption: 'Category' }, { fieldCaption: 'New Field' }],
      };

      beforeEach(() => {
        // The old session doesn't have the field yet; a new session does.
        mocks.mockReadMetadata.mockImplementation(async (request) =>
          Ok({
            data: [
              { fieldCaption: 'Category', fieldName: 'Category', dataType: 'STRING' },
              ...(request.options?.withNewSession
                ? [{ fieldCaption: 'New Field', fieldName: 'New Field', dataType: 'STRING' }]
                : []),
            ],
          }),
        );
      });

      it('validates against the new session, so a field only it knows reaches the query', async () => {
        await getParsed({
          query: newFieldQuery,
          productVersion: productVersion2026_2,
          extraArgs: { options: { withNewSession: true } },
        });

        expect(mocks.mockQueryDatasource).toHaveBeenCalledWith(
          expect.objectContaining({ query: newFieldQuery }),
        );
      });

      it('still rejects a field the old session lacks when no new session is asked for', async () => {
        const result = await getToolResult({
          query: newFieldQuery,
          productVersion: productVersion2026_2,
        });

        expect(result.isError).toBe(true);
        expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
      });

      it('opens the session before the filter-value queries and sends it again on the query', async () => {
        await getParsed({
          query: {
            fields: [{ fieldCaption: 'Category' }],
            filters: [{ field: { fieldCaption: 'Category' }, filterType: 'SET', values: ['C0'] }],
          },
          productVersion: productVersion2026_2,
          extraArgs: { options: { withNewSession: true } },
        });

        const queryCalls = mocks.mockQueryDatasource.mock.calls;
        expect(queryCalls.length).toBeGreaterThan(1);
        expect(mocks.mockReadMetadata.mock.invocationCallOrder[0]).toBeLessThan(
          mocks.mockQueryDatasource.mock.invocationCallOrder[0],
        );
        // One extra session open at most: filter-value queries reuse the one read-metadata opened.
        for (const [request] of queryCalls.slice(0, -1)) {
          expect(request.options).not.toHaveProperty('withNewSession');
        }
        expect(queryCalls.at(-1)?.[0].options.withNewSession).toBe(true);
      });
    });

    it('does not send options to the metadata read when bypassMetadataCache is absent', async () => {
      await getParsed({ query });
      expect(mocks.mockReadMetadata).toHaveBeenCalledWith({ datasource: { datasourceLuid } });
    });

    it('applies options.rowLimit like limit, including the truncation probe', async () => {
      const parsed = await getParsed({ query, extraArgs: { options: { rowLimit: 2 } } });

      expect(mocks.mockQueryDatasource.mock.calls[0][0].options.rowLimit).toBe(3);
      expect(parsed.data).toHaveLength(2);
      expect(parsed.mcp).toEqual({
        resultInfo: { returnedCount: 2, truncated: true, truncationReason: 'requested-limit' },
      });
    });

    it('uses the smaller of limit and options.rowLimit', async () => {
      await getParsed({ query, limit: 1, extraArgs: { options: { rowLimit: 2 } } });
      expect(mocks.mockQueryDatasource.mock.calls[0][0].options.rowLimit).toBe(2);
    });

    it('reports admin-cap when options.rowLimit exceeds the server cap', async () => {
      vi.stubEnv('MAX_RESULT_LIMIT', '2');
      const parsed = await getParsed({ query, extraArgs: { options: { rowLimit: 5 } } });

      expect(parsed.data).toHaveLength(2);
      expect(parsed.mcp.resultInfo).toEqual({
        returnedCount: 2,
        truncated: true,
        truncationReason: 'admin-cap',
      });
    });

    it('trims options.rowLimit client-side on versions that cannot send a rowLimit', async () => {
      const parsed = await getParsed({
        query,
        productVersion: testProductVersion2025_3,
        extraArgs: { options: { rowLimit: 2 } },
      });

      expect(mocks.mockQueryDatasource.mock.calls[0][0].options).not.toHaveProperty('rowLimit');
      expect(parsed.data).toHaveLength(2);
      expect(parsed.mcp.resultInfo).toEqual({
        returnedCount: 2,
        truncated: true,
        truncationReason: 'requested-limit',
      });
    });

    it('emits mcp.warnings without resultInfo when no row limit applies', async () => {
      const parsed = await getParsed({
        query,
        extraArgs: { options: { returnFormat: 'ARRAYS' } },
      });

      expect(parsed.mcp).toEqual({
        warnings: [expect.objectContaining({ affectedProperties: ['options.returnFormat'] })],
      });
    });

    it('returns no warnings for a pasted request whose options match the tool', async () => {
      const parsed = await getParsed({
        datasourceLuid: null,
        query,
        extraArgs: {
          datasource: { datasourceLuid },
          options: { returnFormat: 'OBJECTS', debug: true, disaggregate: false },
        },
      });

      expect(parsed).not.toHaveProperty('mcp');
    });

    it('applies options.interpretFieldCaptionsAsFieldNames like the top-level argument', async () => {
      mocks.mockReadMetadata.mockResolvedValue(
        Ok({ data: [{ fieldCaption: 'Margin', fieldName: 'Calculation_1003', dataType: 'REAL' }] }),
      );
      await getParsed({
        query: { fields: [{ fieldCaption: 'Calculation_1003' }] },
        extraArgs: { options: { interpretFieldCaptionsAsFieldNames: true } },
      });

      expect(
        mocks.mockQueryDatasource.mock.calls[0][0].options.interpretFieldCaptionsAsFieldNames,
      ).toBe(true);
    });

    it('rejects options.interpretFieldCaptionsAsFieldNames on Tableau 2025.2', async () => {
      const result = await getToolResult({
        query,
        productVersion: { value: '2025.2.9', build: '20252.25.1001.1200' },
        extraArgs: { options: { interpretFieldCaptionsAsFieldNames: true } },
      });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('requires Tableau 2025.3 or later');
      expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
    });

    it.each([
      {
        name: 'unknown keys',
        extraArgs: { baz: 1, options: { foo: 1 } },
        message: 'Unrecognized arguments: `baz`, `options.foo`',
      },
      {
        name: 'conflicting LUIDs',
        extraArgs: { datasource: { datasourceLuid: '2d7a3b9e-3f1c-4b8e-9a5d-6c1e2f3a4b5c' } },
        message: 'differ',
      },
    ])('rejects $name before any network call', async ({ extraArgs, message }) => {
      const result = await getToolResult({ query, extraArgs });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(message);
      expect(mocks.mockReadMetadata).not.toHaveBeenCalled();
      expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
    });

    it.each([testProductVersion, { value: '2025.2.9', build: '20252.25.1001.1200' }])(
      'keeps unknown keys through schema parsing on $value',
      async (productVersion) => {
        const tool = getQueryDatasourceTool(new WebMcpServer(), productVersion);
        const schema = await Provider.from(tool.paramsSchema);

        // The MCP SDK parses args with this schema before the callback runs.
        expect(schema.parse({ datasourceLuid, query, options: { foo: 1 }, baz: 2 })).toMatchObject({
          options: { foo: 1 },
          baz: 2,
        });
      },
    );

    it('ignores workbookDatasourceId, never forwards it, and queries the LUID', async () => {
      const parsed = await getParsed({
        datasourceLuid: null,
        query,
        extraArgs: { datasource: { datasourceLuid, workbookDatasourceId: 'Sample - Superstore' } },
      });

      expect(parsed.mcp.warnings).toEqual([
        expect.objectContaining({
          type: 'IGNORED_REQUEST_PROPERTY',
          affectedProperties: ['datasource.workbookDatasourceId'],
        }),
      ]);
      expect(mocks.mockQueryDatasource.mock.calls[0][0].datasource).toEqual({ datasourceLuid });
      expect(JSON.stringify(mocks.mockReadMetadata.mock.calls)).not.toContain(
        'Sample - Superstore',
      );
    });

    it('rejects workbookDatasourceId without a LUID before any network call', async () => {
      const result = await getToolResult({
        datasourceLuid: null,
        query,
        extraArgs: { datasource: { workbookDatasourceId: 'Sample - Superstore' } },
      });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(
        "datasource.workbookDatasourceId isn't used by this tool",
      );
      expect(mocks.mockReadMetadata).not.toHaveBeenCalled();
      expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
    });

    it('checks the allow-list against the LUID even when workbookDatasourceId is given', async () => {
      vi.stubEnv('INCLUDE_DATASOURCE_IDS', 'some-other-datasource-luid');

      const result = await getToolResult({
        datasourceLuid: null,
        query,
        extraArgs: { datasource: { datasourceLuid, workbookDatasourceId: 'Sample - Superstore' } },
      });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(`LUID ${datasourceLuid} is not allowed`);
      expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
    });

    it('rejects an envelope LUID outside the datasource allow-list', async () => {
      vi.stubEnv('INCLUDE_DATASOURCE_IDS', 'some-other-datasource-luid');

      const result = await getToolResult({
        datasourceLuid: null,
        query,
        extraArgs: { datasource: { datasourceLuid } },
      });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(
        `Querying the datasource with LUID ${datasourceLuid} is not allowed.`,
      );
      expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
    });

    describe('option version matrix', () => {
      // Each tier restates every flag, so check every tier for every gated option.
      const tiers = [
        { value: '2025.2.9', build: '20252.25.1001.1200' },
        testProductVersion2025_3,
        testProductVersion,
        productVersion2026_2,
      ];
      const minVersions = { bypassMetadataCache: '2025.3', withNewSession: '2026.2' } as const;
      const isSupported = (version: string, minVersion: string): boolean =>
        version.localeCompare(minVersion, undefined, { numeric: true }) >= 0;

      const cases = tiers.flatMap((productVersion) =>
        Object.entries(minVersions).map(([key, minVersion]) => ({
          key,
          minVersion,
          productVersion,
          supported: isSupported(productVersion.value, minVersion),
        })),
      );

      it.each(cases)(
        '$key: false on $productVersion.value is forwarded only where supported',
        async ({ key, productVersion, supported }) => {
          await getParsed({ query, productVersion, extraArgs: { options: { [key]: false } } });

          const sent = mocks.mockQueryDatasource.mock.calls[0][0].options;
          const sentToMetadataRead = mocks.mockReadMetadata.mock.calls[0][0].options ?? {};
          if (supported) {
            expect(sent[key]).toBe(false);
            expect(sentToMetadataRead[key]).toBe(false);
          } else {
            expect(sent).not.toHaveProperty(key);
            expect(sentToMetadataRead).not.toHaveProperty(key);
          }
        },
      );

      it.each(cases)(
        '$key: true on $productVersion.value is forwarded or names the minimum version',
        async ({ key, minVersion, productVersion, supported }) => {
          const result = await getToolResult({
            query,
            productVersion,
            extraArgs: { options: { [key]: true } },
          });
          invariant(result.content[0].type === 'text');

          if (supported) {
            expect(result.isError, result.content[0].text).toBe(false);
            expect(mocks.mockQueryDatasource.mock.calls[0][0].options[key]).toBe(true);
            expect(mocks.mockReadMetadata.mock.calls[0][0].options[key]).toBe(true);
          } else {
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain(
              `options.${key} requires Tableau ${minVersion} or later`,
            );
            expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
          }
        },
      );

      it.each(tiers)('forwards disaggregate: true on $value', async (productVersion) => {
        await getParsed({ query, productVersion, extraArgs: { options: { disaggregate: true } } });
        expect(mocks.mockQueryDatasource.mock.calls[0][0].options.disaggregate).toBe(true);
      });

      it.each(tiers)(
        'warns on, and never forwards, the read-metadata options on $value',
        async (productVersion) => {
          const options = {
            includeHiddenFields: true,
            includeGroupFormulas: true,
            includeRemoteDatabaseNames: true,
          };
          const parsed = await getParsed({ query, productVersion, extraArgs: { options } });

          expect(parsed.mcp.warnings).toEqual([
            expect.objectContaining({
              type: 'IGNORED_REQUEST_PROPERTY',
              affectedProperties: Object.keys(options).map((key) => `options.${key}`),
            }),
          ]);
          const sent = mocks.mockQueryDatasource.mock.calls[0][0].options;
          for (const key of Object.keys(options)) expect(sent).not.toHaveProperty(key);
        },
      );
    });

    describe('caller-supplied credentials', () => {
      const password = 'caller-secret-password';
      const connections = [{ connectionUsername: 'u', connectionPassword: password }];

      function getLogSinks(): unknown[][] {
        return [
          vi.mocked(loggerModule.log).mock.calls,
          vi.mocked(WebTool.prototype.notifyInvocation).mock.calls,
          vi.mocked(activityLogModule.recordToolCall).mock.calls,
        ];
      }

      beforeEach(() => {
        vi.spyOn(activityLogModule, 'recordToolCall');
        vi.spyOn(WebTool.prototype, 'notifyInvocation');
      });

      it('never logs or forwards datasource.connections', async () => {
        const parsed = await getParsed({
          datasourceLuid: null,
          query: {
            fields: [{ fieldCaption: 'Category' }],
            filters: [{ field: { fieldCaption: 'Category' }, filterType: 'SET', values: ['C0'] }],
          },
          extraArgs: { datasource: { datasourceLuid, connections } },
        });

        expect(parsed.mcp.warnings).toContainEqual(
          expect.objectContaining({ affectedProperties: ['datasource.connections'] }),
        );
        // The SET filter adds a distinct-values query, so both VDS request paths are covered.
        expect(mocks.mockQueryDatasource.mock.calls.length).toBeGreaterThan(1);
        const sinks = [
          ...getLogSinks(),
          mocks.mockReadMetadata.mock.calls,
          mocks.mockQueryDatasource.mock.calls,
        ];
        for (const calls of sinks) {
          expect(calls.length).toBeGreaterThan(0);
          expect(JSON.stringify(calls)).not.toContain(password);
        }
        // An envelope-only LUID still identifies the datasource in the activity log.
        expect(vi.mocked(activityLogModule.recordToolCall).mock.calls[0][0]).toMatchObject({
          object: { type: 'datasource', luid: datasourceLuid },
        });
      });

      // Logging runs before the unknown-key check, so these reach the logs before the error.
      it.each([
        {
          name: 'a top-level connections',
          extraArgs: { connections },
          unknownKey: '`connections`',
          loggedArgs: { connections: '[redacted]' },
        },
        {
          name: 'an unknown options key',
          extraArgs: { options: { disaggregate: true, connectionPassword: password } },
          unknownKey: '`options.connectionPassword`',
          loggedArgs: { options: { disaggregate: true, connectionPassword: '[redacted]' } },
        },
        {
          name: 'an unknown datasource key',
          extraArgs: { datasource: { datasourceLuid, connectionPassword: password } },
          unknownKey: '`datasource.connectionPassword`',
          loggedArgs: { datasource: { datasourceLuid, connectionPassword: '[redacted]' } },
        },
      ])(
        'redacts $name in logs and still rejects it',
        async ({ extraArgs, unknownKey, loggedArgs }) => {
          const result = await getToolResult({ query, extraArgs });

          expect(result.isError).toBe(true);
          invariant(result.content[0].type === 'text');
          expect(result.content[0].text).toContain(unknownKey);
          for (const calls of getLogSinks()) {
            expect(calls.length).toBeGreaterThan(0);
            expect(JSON.stringify(calls)).not.toContain(password);
          }
          // The key name stays visible so the debug log shows what was rejected.
          expect(vi.mocked(WebTool.prototype.notifyInvocation).mock.calls[0][0].args).toMatchObject(
            loggedArgs,
          );
          expect(mocks.mockReadMetadata).not.toHaveBeenCalled();
          expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
        },
      );
    });
  });

  describe('embedded datasources under a project scope', () => {
    const datasourceLuid = '71db762b-6201-466b-93da-57cc0aec8ed9';
    const workbookLuid = '96a43833-27db-40b6-aa80-751efc776b9a';
    const workbookProjectId = 'ae5e9374-2a58-40ab-93e4-a2fd1b07cf7d';

    beforeEach(() => {
      vi.stubEnv('INCLUDE_PROJECT_IDS', workbookProjectId);
      mocks.mockRestQueryDatasource.mockResolvedValue({
        id: datasourceLuid,
        name: 'Embedded',
        parentType: 'Workbook',
        tags: {},
      });
      mocks.mockQueryWorkbookConnections.mockResolvedValue([
        { id: 'connection-1', datasource: { id: datasourceLuid } },
      ]);
      mocks.mockGetWorkbook.mockResolvedValue({
        id: workbookLuid,
        name: 'Workbook',
        project: { id: workbookProjectId, name: 'Project' },
        tags: {},
      });
      mocks.mockQueryDatasource.mockResolvedValue(new Ok(mockVdsResponses.success));
    });

    it('should query an embedded datasource when its workbook is allowed', async () => {
      const result = await getToolResult({ workbookLuid });

      expect(result.isError).toBe(false);
      expect(mocks.mockQueryWorkbookConnections).toHaveBeenCalledWith({
        siteId: 'test-site-id',
        workbookId: workbookLuid,
      });
      expect(mocks.mockQueryDatasource).toHaveBeenCalled();
    });

    it('should not query an embedded datasource without a workbookLuid', async () => {
      const result = await getToolResult();

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(
        'can only be queried by also providing the workbookLuid',
      );
      expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
    });
  });
});

async function getToolResult({
  limit,
  productVersion,
  workbookLuid,
  query,
  interpretFieldCaptionsAsFieldNames,
  datasourceLuid = '71db762b-6201-466b-93da-57cc0aec8ed9',
  extraArgs,
}: {
  query?: Query;
  interpretFieldCaptionsAsFieldNames?: boolean;
  limit?: number;
  productVersion?: ProductVersion;
  workbookLuid?: string;
  datasourceLuid?: string | null;
  // VDS envelope (datasource, options) and unknown keys, as a pasted QueryRequest would carry them.
  extraArgs?: Record<string, unknown>;
} = {}): Promise<CallToolResult> {
  const queryDatasourceTool = getQueryDatasourceTool(
    new WebMcpServer(),
    productVersion ?? testProductVersion,
  );
  const callback = await Provider.from(queryDatasourceTool.callback);
  return await callback(
    {
      ...(datasourceLuid !== null && { datasourceLuid }),
      query: query ?? {
        fields: [
          { fieldCaption: 'Category' },
          { fieldCaption: 'Profit', function: 'SUM', sortDirection: 'DESC' },
        ],
      },
      workbookLuid,
      limit,
      interpretFieldCaptionsAsFieldNames,
      ...extraArgs,
    },
    getMockRequestHandlerExtra(),
  );
}
