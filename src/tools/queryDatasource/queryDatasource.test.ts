import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { server } from '../../server.js';
import { queryDatasourceTool } from './queryDatasource.js';

// Mock server.server.sendLoggingMessage since the transport won't be connected.
vi.spyOn(server.server, 'sendLoggingMessage').mockImplementation(vi.fn());

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
    errorCode: '500101',
    message: 'Tableau Server User session has timed out',
    datetime: '2024-06-19T17:51:36.4771244Z',
    details: null,
  },
}));

const mocks = vi.hoisted(() => ({
  mockQueryDatasource: vi.fn(),
  mockQueryDatasourceSuccess: vi.fn().mockResolvedValue(mockVdsResponses.success),
  mockQueryDatasourceError: vi.fn().mockRejectedValue(mockVdsResponses.error),
}));

vi.mock('../../restApiInstance.js', () => ({
  getNewRestApiInstanceAsync: vi.fn().mockResolvedValue({
    vizqlDataServiceMethods: {
      queryDatasource: mocks.mockQueryDatasource,
    },
  }),
}));

vi.mock('node:crypto', () => {
  return { randomUUID: vi.fn(() => '123e4567-e89b-12d3-a456-426614174000') };
});

describe('queryDatasourceTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
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
        debug: false,
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
    mocks.mockQueryDatasource.mockRejectedValue(mockVdsResponses.error);

    const result = await getToolResult();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Tableau Server User session has timed out');
    expect(mocks.mockQueryDatasource).toHaveBeenCalledWith({
      datasource: {
        datasourceLuid: '71db762b-6201-466b-93da-57cc0aec8ed9',
      },
      options: {
        debug: false,
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
    expect(result.content[0].text).toBe(
      'requestId: 123e4567-e89b-12d3-a456-426614174000, error: API Error',
    );
  });
});

async function getToolResult(): Promise<CallToolResult> {
  return await queryDatasourceTool.callback(
    {
      datasourceLuid: '71db762b-6201-466b-93da-57cc0aec8ed9',
      datasourceQuery: {
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
