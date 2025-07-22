import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { Server } from '../../server.js';
import { exportedForTesting as datasourceCredentialsExportedForTesting } from './datasourceCredentials.js';
import { getQueryDatasourceTool } from './queryDatasource.js';

const { resetDatasourceCredentials } = datasourceCredentialsExportedForTesting;

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
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    resetDatasourceCredentials();
    process.env = {
      ...originalEnv,
    };
  });

  it('should create a tool instance with correct properties', () => {
    const queryDatasourceTool = getQueryDatasourceTool(new Server());
    expect(queryDatasourceTool.name).toBe('query-datasource');
    expect(queryDatasourceTool.description).toEqual(expect.any(String));
    expect(queryDatasourceTool.paramsSchema).not.toBeUndefined();
  });

  it('should successfully query the datasource', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(new Ok(mockVdsResponses.success));

    const result = await getToolResult();

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text as string)).toEqual(mockVdsResponses.success);
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

  it('should add datasource credentials to the request when provided', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(new Ok(mockVdsResponses.success));

    process.env.DATASOURCE_CREDENTIALS = JSON.stringify({
      '71db762b-6201-466b-93da-57cc0aec8ed9': [
        { luid: 'test-luid', u: 'test-user', p: 'test-pass' },
      ],
    });

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

  it('should return error VDS returns an error', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(new Err(mockVdsResponses.error));

    const result = await getToolResult();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      JSON.stringify({
        requestId: 'test-request-id',
        ...mockVdsResponses.error,
        condition: 'Validation failed',
        details: "The incoming request isn't valid per the validation rules.",
      }),
    );
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
    expect(result.content[0].text).toBe('requestId: test-request-id, error: API Error');
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
      const queryDatasourceTool = getQueryDatasourceTool(new Server());
      const result = await queryDatasourceTool.callback(
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
        },
        {
          signal: new AbortController().signal,
          requestId: 'test-request-id',
          sendNotification: vi.fn(),
          sendRequest: vi.fn(),
        },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Filter validation failed for field "Region"');
      expect(result.content[0].text).toContain('Wast');
      expect(result.content[0].text).toContain('Did you mean:');
      expect(result.content[0].text).toContain('West'); // Should suggest fuzzy match

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
      const queryDatasourceTool = getQueryDatasourceTool(new Server());
      const result = await queryDatasourceTool.callback(
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
        },
        {
          signal: new AbortController().signal,
          requestId: 'test-request-id',
          sendNotification: vi.fn(),
          sendRequest: vi.fn(),
        },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        'Filter validation failed for field "Customer Name"',
      );
      expect(result.content[0].text).toContain('starts with "Jon"');
      expect(result.content[0].text).toContain('Similar values in this field:');
      expect(result.content[0].text).toContain('John Doe'); // Should suggest similar value

      // Should call main query first, then validation query
      expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(1);
    });

    it('should return main query results when no SET/MATCH filters are present', async () => {
      const mockMainQueryResult = {
        data: [{ Region: 'East', 'SUM(Sales)': 100000 }],
      };

      // Mock main query only
      mocks.mockQueryDatasource.mockResolvedValueOnce(new Ok(mockMainQueryResult));

      const queryDatasourceTool = getQueryDatasourceTool(new Server());
      const result = await queryDatasourceTool.callback(
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
        },
        {
          signal: new AbortController().signal,
          requestId: 'test-request-id',
          sendNotification: vi.fn(),
          sendRequest: vi.fn(),
        },
      );

      expect(result.isError).toBe(false);
      expect(JSON.parse(result.content[0].text as string)).toEqual(mockMainQueryResult);

      // Should only call the main query (no validation needed)
      expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(1);
    });

    it('should not run SET/MATCH filters validation when DISABLE_DATASOURCE_QUERY_FILTER_VALIDATION environment variable is true', async () => {
      process.env.DISABLE_QUERY_DATASOURCE_FILTER_VALIDATION = 'true';

      const mockMainQueryResult = {
        data: [{ Region: 'East', 'SUM(Sales)': 100000 }],
      };

      // Mock main query only
      mocks.mockQueryDatasource.mockResolvedValueOnce(new Ok(mockMainQueryResult));

      const queryDatasourceTool = getQueryDatasourceTool(new Server());
      const result = await queryDatasourceTool.callback(
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
        },
        {
          signal: new AbortController().signal,
          requestId: 'test-request-id',
          sendNotification: vi.fn(),
          sendRequest: vi.fn(),
        },
      );

      expect(result.isError).toBe(false);
      expect(JSON.parse(result.content[0].text as string)).toEqual(mockMainQueryResult);

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

      const queryDatasourceTool = getQueryDatasourceTool(new Server());
      const result = await queryDatasourceTool.callback(
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
        },
        {
          signal: new AbortController().signal,
          requestId: 'test-request-id',
          sendNotification: vi.fn(),
          sendRequest: vi.fn(),
        },
      );

      expect(result.isError).toBe(true);
      const errorText = result.content[0].text as string;
      expect(errorText).toContain('Filter validation failed for field "Region"');
      expect(errorText).toContain('Filter validation failed for field "Category"');
      expect(errorText).toContain('InvalidRegion');
      expect(errorText).toContain('InvalidCategory');

      // Should call main query first, then both validation queries
      expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(2);
    });
  });
});

async function getToolResult(): Promise<CallToolResult> {
  const queryDatasourceTool = getQueryDatasourceTool(new Server());
  return await queryDatasourceTool.callback(
    {
      datasourceLuid: '71db762b-6201-466b-93da-57cc0aec8ed9',
      query: {
        fields: [
          { fieldCaption: 'Category' },
          { fieldCaption: 'Profit', function: 'SUM', sortDirection: 'DESC' },
        ],
      },
    },
    {
      signal: new AbortController().signal,
      requestId: 'test-request-id',
      sendNotification: vi.fn(),
      sendRequest: vi.fn(),
    },
  );
}
