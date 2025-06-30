import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { PulseMetricDefinition } from '../../sdks/tableau/types/pulse.js';
import { server } from '../../server.js';
import { listPulseMetricDefinitionsFromDefinitionIdsTool } from './listPulseMetricDefinitionsFromDefinitionIds.js';

// Mock server.server.sendLoggingMessage since the transport won't be connected.
vi.spyOn(server.server, 'sendLoggingMessage').mockImplementation(vi.fn());

const mockPulseMetricDefinitions: PulseMetricDefinition[] = [
  {
    metadata: { name: 'Pulse Metric 1', id: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C4' },
    specification: { datasource: { id: 'A6FC3C9F-4F40-4906-8DB0-AC70C5FB5A11' } },
    metrics: [
      { id: 'CF32DDCC-362B-4869-9487-37DA4D152552', is_default: true, is_followed: false },
      { id: 'CF32DDCC-362B-4869-9487-37DA4D152553', is_default: false, is_followed: true },
    ],
  },
  {
    metadata: { name: 'Pulse Metric 2', id: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C5' },
    specification: { datasource: { id: 'A6FC3C9F-4F40-4906-8DB0-AC70C5FB5A12' } },
    metrics: [{ id: 'CF32DDCC-362B-4869-9487-37DA4D152554', is_default: true, is_followed: false }],
  },
  {
    metadata: { name: 'Pulse Metric 3', id: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C6' },
    specification: { datasource: { id: 'A6FC3C9F-4F40-4906-8DB0-AC70C5FB5A11' } },
    metrics: [],
  },
];

const mocks = vi.hoisted(() => ({
  mockListPulseMetricDefinitionsFromMetricDefinitionIds: vi.fn(),
}));

vi.mock('../../restApiInstance.js', () => ({
  getNewRestApiInstanceAsync: vi.fn().mockResolvedValue({
    pulseMethods: {
      listPulseMetricDefinitionsFromMetricDefinitionIds:
        mocks.mockListPulseMetricDefinitionsFromMetricDefinitionIds,
    },
  }),
}));

describe('listPulseMetricDefinitionsFromDefinitionIdsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    expect(listPulseMetricDefinitionsFromDefinitionIdsTool.name).toBe(
      'list-pulse-metric-definitions-from-definition-ids',
    );
    expect(listPulseMetricDefinitionsFromDefinitionIdsTool.description).toContain(
      'Retrieves a list of published Pulse Metric Definitions',
    );
    expect(listPulseMetricDefinitionsFromDefinitionIdsTool.paramsSchema).toMatchObject({
      metricDefinitionIds: expect.any(Object),
      view: expect.any(Object),
    });
  });

  it.each<{
    view: 'DEFINITION_VIEW_BASIC' | 'DEFINITION_VIEW_FULL' | 'DEFINITION_VIEW_DEFAULT';
    label: string;
  }>([
    { view: 'DEFINITION_VIEW_BASIC', label: 'basic view' },
    { view: 'DEFINITION_VIEW_FULL', label: 'full view' },
    { view: 'DEFINITION_VIEW_DEFAULT', label: 'default view' },
  ])('should list pulse metric definitions from IDs with $label', async ({ view }) => {
    mocks.mockListPulseMetricDefinitionsFromMetricDefinitionIds.mockResolvedValue(
      mockPulseMetricDefinitions,
    );
    const result = await getToolResult({
      metricDefinitionIds: [
        mockPulseMetricDefinitions[0].metadata.id,
        mockPulseMetricDefinitions[1].metadata.id,
        mockPulseMetricDefinitions[2].metadata.id,
      ],
      view,
    });
    expect(result.isError).toBe(false);
    const parsedValue = JSON.parse(result.content[0].text as string);
    expect(parsedValue).toEqual(mockPulseMetricDefinitions);
    expect(mocks.mockListPulseMetricDefinitionsFromMetricDefinitionIds).toHaveBeenCalledWith(
      [
        mockPulseMetricDefinitions[0].metadata.id,
        mockPulseMetricDefinitions[1].metadata.id,
        mockPulseMetricDefinitions[2].metadata.id,
      ],
      view,
    );
  });

  it('should list pulse metric definitions from IDs with no view (default)', async () => {
    mocks.mockListPulseMetricDefinitionsFromMetricDefinitionIds.mockResolvedValue(
      mockPulseMetricDefinitions,
    );
    const result = await getToolResult({
      metricDefinitionIds: [
        mockPulseMetricDefinitions[0].metadata.id,
        mockPulseMetricDefinitions[1].metadata.id,
        mockPulseMetricDefinitions[2].metadata.id,
      ],
    });
    expect(result.isError).toBe(false);
    const parsedValue = JSON.parse(result.content[0].text as string);
    expect(parsedValue).toEqual(mockPulseMetricDefinitions);
    expect(mocks.mockListPulseMetricDefinitionsFromMetricDefinitionIds).toHaveBeenCalledWith(
      [
        mockPulseMetricDefinitions[0].metadata.id,
        mockPulseMetricDefinitions[1].metadata.id,
        mockPulseMetricDefinitions[2].metadata.id,
      ],
      undefined,
    );
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockListPulseMetricDefinitionsFromMetricDefinitionIds.mockRejectedValue(
      new Error(errorMessage),
    );
    const result = await getToolResult({
      metricDefinitionIds: [mockPulseMetricDefinitions[0].metadata.id],
      view: 'DEFINITION_VIEW_BASIC',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should return an error for an invalid view value', async () => {
    mocks.mockListPulseMetricDefinitionsFromMetricDefinitionIds.mockRejectedValue({
      errorCode: '-32602',
      message:
        'Invalid arguments for tool list-pulse-metric-definitions-from-definition-ids: Enumeration value must be one of: DEFINITION_VIEW_BASIC, DEFINITION_VIEW_FULL, DEFINITION_VIEW_DEFAULT "path": "view"',
    });
    // Intentionally passing invalid value for testing
    const result = await getToolResult({
      metricDefinitionIds: [mockPulseMetricDefinitions[0].metadata.id],
      view: 'INVALID_VIEW',
    } as any);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('view');
    expect(result.content[0].text).toContain('Enumeration value must be one of');
    expect(result.content[0].text).toContain(
      'DEFINITION_VIEW_BASIC, DEFINITION_VIEW_FULL, DEFINITION_VIEW_DEFAULT',
    );
  });

  it('should return an error for missing metricDefinitionIds', async () => {
    mocks.mockListPulseMetricDefinitionsFromMetricDefinitionIds.mockRejectedValue({
      errorCode: '-32602',
      message: `MCP error -32602: MCP error -32602: Invalid arguments for tool list-pulse-metric-definitions-from-definition-ids: [
        {
          "code": "too_small",
          "minimum": 1,
          "type": "array",
          "inclusive": true,
          "exact": false,
          "message": "Array must contain at least 1 element(s)",
          "path": [
            "metricDefinitionIds"
          ]
        }
      ]`,
    });
    // Intentionally omitting required parameter for testing
    const result = await getToolResult({} as any);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('metricDefinitionIds');
    expect(result.content[0].text).toContain('Array must contain at least 1 element(s)');
  });
});

it('should return an error for is metricDefinitionId is too small', async () => {
  mocks.mockListPulseMetricDefinitionsFromMetricDefinitionIds.mockRejectedValue({
    errorCode: '-32602',
    message: `MCP error -32602: MCP error -32602: Invalid arguments for tool list-pulse-metric-definitions-from-definition-ids: [
      {
        "code": "too_small",
        "minimum": 36,
        "type": "string",
        "inclusive": true,
        "exact": true,
        "message": "String must contain exactly 36 character(s)",
        "path": [
          "metricDefinitionIds",
          0
        ]
      }
    ]`,
  });
  // Intentionally omitting required parameter for testing
  const result = await getToolResult({
    metricDefinitionIds: ['123'],
  });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('metricDefinitionIds');
  expect(result.content[0].text).toContain('String must contain exactly 36 character(s)');
});

async function getToolResult(params: {
  metricDefinitionIds: string[];
  view?: 'DEFINITION_VIEW_BASIC' | 'DEFINITION_VIEW_FULL' | 'DEFINITION_VIEW_DEFAULT';
}): Promise<CallToolResult> {
  return await listPulseMetricDefinitionsFromDefinitionIdsTool.callback(params, {
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  });
}
