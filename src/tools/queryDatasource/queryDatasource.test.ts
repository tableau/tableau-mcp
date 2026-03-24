import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { TableauMCPErrorFactory } from '../../errors/error.js';
import { ProductVersion } from '../../sdks/tableau/types/serverInfo.js';
import { Server } from '../../server.js';
import {
  stubDefaultEnvVars,
  testProductVersion,
  testProductVersion2025_3,
} from '../../testShared.js';
import invariant from '../../utils/invariant.js';
import { Provider } from '../../utils/provider.js';
import { getVizqlDataServiceDisabledError } from '../getVizqlDataServiceDisabledError.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
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
}));

vi.mock('../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      signIn: vi.fn(),
      signOut: vi.fn(),
      vizqlDataServiceMethods: {
        queryDatasource: mocks.mockQueryDatasource,
      },
    }),
  ),
}));

describe('queryDatasourceTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    resetDatasourceCredentials();
    resetResourceAccessCheckerSingleton();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', () => {
    const queryDatasourceTool = getQueryDatasourceTool(new Server(), testProductVersion);
    expect(queryDatasourceTool.name).toBe('query-datasource');
    expect(queryDatasourceTool.description).toBeInstanceOf(Provider);
    expect(queryDatasourceTool.paramsSchema).not.toBeUndefined();
  });

  it('should return error when query args fail validation', async () => {
    const queryDatasourceTool = getQueryDatasourceTool(new Server(), testProductVersion);
    const callback = await Provider.from(queryDatasourceTool.callback);

    const result = await callback(
      {
        datasourceLuid: '',
        query: { fields: [{ fieldCaption: 'Category' }] },
        limit: undefined,
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
    expect(JSON.parse(result.content[0].text)).toEqual(mockVdsResponses.success);
    expect(mocks.mockQueryDatasource).toHaveBeenCalledWith({
      datasource: {
        datasourceLuid: '71db762b-6201-466b-93da-57cc0aec8ed9',
      },
      options: {
        debug: true,
        disaggregate: false,
        returnFormat: 'OBJECTS',
        rowLimit: 100,
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

  it('should return a successful result when the VDS response contains a schema validation error', async () => {
    const badResponse = {
      ...mockVdsResponses.success,
      data: 'hamburgers',
    };

    mocks.mockQueryDatasource.mockImplementation(() => {
      const zodiosError = TableauMCPErrorFactory.zodiosError(
        'Zodios: Invalid response from endpoint',
        badResponse.toString(),
        'Validation error: Expected array, received string at "data"',
      );

      return new Err(zodiosError);
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
    mocks.mockQueryDatasource.mockResolvedValue(new Err(mockVdsResponses.error));

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
      const queryDatasourceTool = getQueryDatasourceTool(new Server(), testProductVersion);
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
          limit: undefined,
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
      const queryDatasourceTool = getQueryDatasourceTool(new Server(), testProductVersion);
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
          limit: undefined,
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

      const queryDatasourceTool = getQueryDatasourceTool(new Server(), testProductVersion);
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
          limit: undefined,
        },
        getMockRequestHandlerExtra(),
      );

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(JSON.parse(result.content[0].text)).toEqual(mockMainQueryResult);

      // Should only call the main query (no validation needed)
      expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(1);
    });

    it('should not run SET/MATCH filters validation when DISABLE_QUERY_VALIDATION_REQUESTS environment variable is true', async () => {
      process.env.DISABLE_QUERY_VALIDATION_REQUESTS = 'true';

      const mockMainQueryResult = {
        data: [{ Region: 'East', 'SUM(Sales)': 100000 }],
      };

      // Mock main query only
      mocks.mockQueryDatasource.mockResolvedValueOnce(new Ok(mockMainQueryResult));

      const queryDatasourceTool = getQueryDatasourceTool(new Server(), testProductVersion);
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
          limit: undefined,
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

      const queryDatasourceTool = getQueryDatasourceTool(new Server(), testProductVersion);
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
          limit: undefined,
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

  it('should show feature-disabled error when VDS is disabled', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(
      Err(TableauMCPErrorFactory.featureDisabled(getVizqlDataServiceDisabledError())),
    );

    const result = await getToolResult();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(getVizqlDataServiceDisabledError());
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
});

async function getToolResult({
  limit,
  productVersion,
}: {
  limit?: number;
  productVersion?: ProductVersion;
} = {}): Promise<CallToolResult> {
  const queryDatasourceTool = getQueryDatasourceTool(
    new Server(),
    productVersion ?? testProductVersion,
  );
  const callback = await Provider.from(queryDatasourceTool.callback);
  return await callback(
    {
      datasourceLuid: '71db762b-6201-466b-93da-57cc0aec8ed9',
      query: {
        fields: [
          { fieldCaption: 'Category' },
          { fieldCaption: 'Profit', function: 'SUM', sortDirection: 'DESC' },
        ],
      },
      limit,
    },
    getMockRequestHandlerExtra(),
  );
}
