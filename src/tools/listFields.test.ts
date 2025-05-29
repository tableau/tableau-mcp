import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { server } from '../server.js';
import { getGraphqlQuery, listFieldsTool } from './listFields.js';

// Mock server.server.sendLoggingMessage since the transport won't be connected.
vi.spyOn(server.server, 'sendLoggingMessage').mockImplementation(vi.fn());

const mockMetadataResponses = vi.hoisted(() => ({
  success: {
    data: {
      publishedDatasources: [
        {
          name: 'Test Datasource',
          description: 'Test Description',
          datasourceFilters: [{ field: { name: 'Filter1', description: 'Filter 1 Desc' } }],
          fields: [
            { name: 'Field1', description: 'Field 1 Desc' },
            { name: 'Field2', description: 'Field 2 Desc' },
          ],
        },
      ],
    },
  },
  error: {
    data: {
      publishedDatasources: [],
    },
  },
}));

const mocks = vi.hoisted(() => ({
  mockGraphql: vi.fn(),
}));

vi.mock('../restApiInstance.js', () => ({
  getNewRestApiInstanceAsync: vi.fn().mockResolvedValue({
    metadataMethods: {
      graphql: mocks.mockGraphql,
    },
  }),
}));

vi.mock('node:crypto', () => {
  return { randomUUID: vi.fn(() => '123e4567-e89b-12d3-a456-426614174000') };
});

describe('listFieldsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    expect(listFieldsTool.name).toBe('list-fields');
    expect(listFieldsTool.description).toContain('Fetches field metadata');
    expect(listFieldsTool.paramsSchema).toMatchObject({ datasourceLuid: expect.any(Object) });
  });

  it('should successfully fetch and return field metadata', async () => {
    mocks.mockGraphql.mockResolvedValue(mockMetadataResponses.success);

    const result = await getToolResult();

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text as string)).toEqual(mockMetadataResponses.success);
    expect(mocks.mockGraphql).toHaveBeenCalledWith(getGraphqlQuery('test-luid'));
  });

  it('should return error when no published datasources are found', async () => {
    mocks.mockGraphql.mockResolvedValue(mockMetadataResponses.error);

    const result = await getToolResult();
    expect(result.isError).toBe(true);
    expect(result.content[0].text as string).toBe(
      '{"requestId":"123e4567-e89b-12d3-a456-426614174000","error":"No published datasources in response"}',
    );
    expect(mocks.mockGraphql).toHaveBeenCalledWith(getGraphqlQuery('test-luid'));
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockGraphql.mockRejectedValue(new Error(errorMessage));

    const result = await getToolResult();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'requestId: 123e4567-e89b-12d3-a456-426614174000, error: API Error',
    );
  });
});

async function getToolResult(): Promise<CallToolResult> {
  return await listFieldsTool.callback(
    { datasourceLuid: 'test-luid' },
    {
      signal: new AbortController().signal,
      requestId: 'test-request-id',
      sendNotification: vi.fn(),
      sendRequest: vi.fn(),
    },
  );
}
