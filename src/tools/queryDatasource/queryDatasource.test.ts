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
  getNewRestApiInstanceAsync: vi.fn().mockResolvedValue({
    vizqlDataServiceMethods: {
      queryDatasource: mocks.mockQueryDatasource,
    },
  }),
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
    it('should return validation error for SET filter with invalid values and suggest fuzzy matches when main query returns empty', async () => {
      // Mock main query to return empty results (triggering validation)
      mocks.mockQueryDatasource
        .mockResolvedValueOnce(new Ok({ data: [] }))
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
      if (result.isError) {
        expect(result.content[0].text).toContain('Filter validation failed for field "Region"');
        expect(result.content[0].text).toContain('Wast');
        expect(result.content[0].text).toContain('Did you mean:');
        expect(result.content[0].text).toContain('West'); // Should suggest fuzzy match
        expect(result.content[0].text).toContain(
          'evaluate whether you included the wrong filter value',
        );
      }

      // Should call main query first, then validation query
      expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(2);
    });

    it('should return validation error for MATCH filter with invalid pattern and suggest similar values when main query returns empty', async () => {
      // Mock main query to return empty results (triggering validation)
      mocks.mockQueryDatasource
        .mockResolvedValueOnce(new Ok({ data: [] }))
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
      if (result.isError) {
        expect(result.content[0].text).toContain(
          'Filter validation failed for field "Customer Name"',
        );
        expect(result.content[0].text).toContain('starts with "Jon"');
        expect(result.content[0].text).toContain('Similar values in this field:');
        expect(result.content[0].text).toContain('John Doe'); // Should suggest similar value
        expect(result.content[0].text).toContain(
          'evaluate whether you included the wrong filter value',
        );
      }

      // Should call main query first, then validation query
      expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(2);
    });

    it('should return main query results when query has data (no validation triggered)', async () => {
      const mockMainQueryResult = {
        data: [
          { Region: 'East', 'SUM(Sales)': 100000 },
          { Region: 'West', 'SUM(Sales)': 150000 },
        ],
      };

      // Mock main query to return data (validation won't be triggered)
      mocks.mockQueryDatasource.mockResolvedValueOnce(new Ok(mockMainQueryResult));

      const queryDatasourceTool = getQueryDatasourceTool(new Server());
      const result = await queryDatasourceTool.callback(
        {
          datasourceLuid: 'test-datasource-luid',
          query: {
            fields: [{ fieldCaption: 'Region' }, { fieldCaption: 'Sales', function: 'SUM' }],
            filters: [
              {
                field: { fieldCaption: 'Region' },
                filterType: 'SET',
                values: ['East', 'West'],
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
      if (!result.isError) {
        expect(JSON.parse(result.content[0].text as string)).toEqual(mockMainQueryResult);
      }

      // Should only call the main query (validation not triggered)
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
      if (!result.isError) {
        expect(JSON.parse(result.content[0].text as string)).toEqual(mockMainQueryResult);
      }

      // Should only call the main query (no validation needed)
      expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(1);
    });

    it('should return main query results when validation query fails gracefully', async () => {
      const mockMainQueryResult = {
        data: [],
      };

      // Mock main query to return empty (triggering validation), then validation to fail
      mocks.mockQueryDatasource
        .mockResolvedValueOnce(new Ok(mockMainQueryResult))
        .mockResolvedValueOnce(new Err({ errorCode: '404934', message: 'Field not found' }));

      const queryDatasourceTool = getQueryDatasourceTool(new Server());
      const result = await queryDatasourceTool.callback(
        {
          datasourceLuid: 'test-datasource-luid',
          query: {
            fields: [{ fieldCaption: 'Region' }, { fieldCaption: 'Sales', function: 'SUM' }],
            filters: [
              {
                field: { fieldCaption: 'Region' },
                filterType: 'SET',
                values: ['East'],
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
      if (!result.isError) {
        expect(JSON.parse(result.content[0].text as string)).toEqual(mockMainQueryResult);
      }

      // Should call main query and validation query (which fails gracefully)
      expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(2);
    });

    it('should return multiple validation errors when multiple filters fail and main query returns empty', async () => {
      // Mock main query to return empty results (triggering validation)
      mocks.mockQueryDatasource
        .mockResolvedValueOnce(new Ok({ data: [] }))
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
      if (result.isError) {
        const errorText = result.content[0].text as string;
        expect(errorText).toContain('Filter validation failed for field "Region"');
        expect(errorText).toContain('Filter validation failed for field "Category"');
        expect(errorText).toContain('InvalidRegion');
        expect(errorText).toContain('InvalidCategory');
      }

      // Should call main query first, then both validation queries
      expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(3);
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
