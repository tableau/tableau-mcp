import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { server } from '../server.js';
import { readMetadataTool } from './readMetadata.js';

// Mock server.server.sendLoggingMessage since the transport won't be connected.
vi.spyOn(server.server, 'sendLoggingMessage').mockImplementation(vi.fn());

const mockMetadataResponses = vi.hoisted(() => ({
  success: {
    data: [
      {
        fieldName: 'Calculation_123456789',
        fieldCaption: 'Profit Ratio',
        dataType: 'REAL',
        logicalTableId: '',
      },
      {
        fieldName: 'Product Name',
        fieldCaption: 'Product Name',
        dataType: 'STRING',
        logicalTableId: 'Orders_123456789',
      },
      {
        fieldName: 'Quantity',
        fieldCaption: 'Quantity',
        dataType: 'INTEGER',
        logicalTableId: 'Orders_123456789',
      },
    ],
  },
  empty: {
    data: [],
  },
}));

const mocks = vi.hoisted(() => ({
  mockReadMetadata: vi.fn(),
}));

vi.mock('../restApiInstance.js', () => ({
  getNewRestApiInstanceAsync: vi.fn().mockResolvedValue({
    vizqlDataServiceMethods: {
      readMetadata: mocks.mockReadMetadata,
    },
  }),
}));

vi.mock('node:crypto', () => {
  return { randomUUID: vi.fn(() => '123e4567-e89b-12d3-a456-426614174000') };
});

describe('readMetadataTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    expect(readMetadataTool.name).toBe('read-metadata');
    expect(readMetadataTool.description).toEqual(expect.any(String));
    expect(readMetadataTool.paramsSchema).toMatchObject({ datasourceLuid: expect.any(Object) });
  });

  it('should successfully fetch and return metadata', async () => {
    mocks.mockReadMetadata.mockResolvedValue(mockMetadataResponses.success);

    const result = await getToolResult();

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toEqual(JSON.stringify(mockMetadataResponses.success));
    expect(mocks.mockReadMetadata).toHaveBeenCalledWith({
      datasource: {
        datasourceLuid: 'test-luid',
      },
    });
  });

  it('should successfully fetch and return empty list when no metadata is found', async () => {
    mocks.mockReadMetadata.mockResolvedValue(mockMetadataResponses.empty);

    const result = await getToolResult();

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toEqual(JSON.stringify(mockMetadataResponses.empty));
    expect(mocks.mockReadMetadata).toHaveBeenCalledWith({
      datasource: {
        datasourceLuid: 'test-luid',
      },
    });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockReadMetadata.mockRejectedValue(new Error(errorMessage));

    const result = await getToolResult();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'requestId: 123e4567-e89b-12d3-a456-426614174000, error: API Error',
    );
  });
});

async function getToolResult(): Promise<CallToolResult> {
  return await readMetadataTool.callback(
    { datasourceLuid: 'test-luid' },
    {
      signal: new AbortController().signal,
      requestId: 'test-request-id',
      sendNotification: vi.fn(),
      sendRequest: vi.fn(),
    },
  );
}
