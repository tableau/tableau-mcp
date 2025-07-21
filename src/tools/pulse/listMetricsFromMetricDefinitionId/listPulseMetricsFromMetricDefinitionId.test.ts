import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { PulseMetric } from '../../../sdks/tableau/types/pulse.js';
import { Server } from '../../../server.js';
import { getListPulseMetricsFromMetricDefinitionIdTool } from './listPulseMetricsFromMetricDefinitionId.js';

const mockPulseMetrics: PulseMetric[] = [
  {
    id: 'CF32DDCC-362B-4869-9487-37DA4D152550',
    is_default: true,
    is_followed: false,
  } as PulseMetric,
  {
    id: 'CF32DDCC-362B-4869-9487-37DA4D152551',
    is_default: false,
    is_followed: true,
  } as PulseMetric,
];

const mocks = vi.hoisted(() => ({
  mockListPulseMetricsFromMetricDefinitionId: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      pulseMethods: {
        listPulseMetricsFromMetricDefinitionId: mocks.mockListPulseMetricsFromMetricDefinitionId,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('listPulseMetricsFromMetricDefinitionIdTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const listPulseMetricsFromMetricDefinitionIdTool =
      getListPulseMetricsFromMetricDefinitionIdTool(new Server());
    expect(listPulseMetricsFromMetricDefinitionIdTool.name).toBe(
      'list-pulse-metrics-from-metric-definition-id',
    );
    expect(listPulseMetricsFromMetricDefinitionIdTool.description).toContain(
      'Retrieves a list of published Pulse Metrics from a Pulse Metric Definition',
    );
    expect(listPulseMetricsFromMetricDefinitionIdTool.paramsSchema).toMatchObject({
      pulseMetricDefinitionID: expect.any(Object),
    });
  });

  it('should list pulse metrics for a given definition ID', async () => {
    mocks.mockListPulseMetricsFromMetricDefinitionId.mockResolvedValue(mockPulseMetrics);
    const result = await getToolResult({
      pulseMetricDefinitionID: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
    });
    expect(result.isError).toBe(false);
    expect(mocks.mockListPulseMetricsFromMetricDefinitionId).toHaveBeenCalledWith(
      'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
    );
    const parsedValue = JSON.parse(result.content[0].text as string);
    expect(parsedValue).toEqual(mockPulseMetrics);
  });

  it('should require a non-empty pulseMetricDefinitionID', async () => {
    mocks.mockListPulseMetricsFromMetricDefinitionId.mockRejectedValue({
      errorCode: '-32602',
      message:
        'Invalid arguments for tool list-pulse-metrics: String must contain 36 character(s) "path": "pulseMetricDefinitionID"',
    });
    const result = await getToolResult({ pulseMetricDefinitionID: '' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('pulseMetricDefinitionID');
    expect(result.content[0].text).toContain('Invalid arguments for tool list-pulse-metrics');
    expect(result.content[0].text).toContain('String must contain 36 character(s)');
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockListPulseMetricsFromMetricDefinitionId.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({
      pulseMetricDefinitionID: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(errorMessage);
  });
});

async function getToolResult(params: { pulseMetricDefinitionID: string }): Promise<CallToolResult> {
  const listPulseMetricsFromMetricDefinitionIdTool = getListPulseMetricsFromMetricDefinitionIdTool(
    new Server(),
  );
  return await listPulseMetricsFromMetricDefinitionIdTool.callback(params, {
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  });
}
