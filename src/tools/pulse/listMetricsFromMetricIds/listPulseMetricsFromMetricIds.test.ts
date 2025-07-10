import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { PulseMetric } from '../../../sdks/tableau/types/pulse.js';
import { Server } from '../../../server.js';
import { getListPulseMetricsFromMetricIdsTool } from './listPulseMetricsFromMetricIds.js';

const mockPulseMetrics: PulseMetric[] = [
  {
    id: 'CF32DDCC-362B-4869-9487-37DA4D152552',
    is_default: true,
    is_followed: false,
  } as PulseMetric,
  {
    id: 'CF32DDCC-362B-4869-9487-37DA4D152553',
    is_default: false,
    is_followed: true,
  } as PulseMetric,
];

const mocks = vi.hoisted(() => ({
  mockListPulseMetricsFromMetricIds: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi
    .fn()
    .mockImplementation(async (_host, _authConfig, _requestId, _server, callback) =>
      callback({
        pulseMethods: {
          listPulseMetricsFromMetricIds: mocks.mockListPulseMetricsFromMetricIds,
        },
        siteId: 'test-site-id',
      }),
    ),
}));

describe('listPulseMetricsFromMetricIdsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const listPulseMetricsFromMetricIdsTool = getListPulseMetricsFromMetricIdsTool(new Server());
    expect(listPulseMetricsFromMetricIdsTool.name).toBe('list-pulse-metrics-from-metric-ids');
    expect(listPulseMetricsFromMetricIdsTool.description).toContain(
      'Retrieves a list of published Pulse Metrics from a list of metric IDs',
    );
    expect(listPulseMetricsFromMetricIdsTool.paramsSchema).toMatchObject({
      metricIds: expect.any(Object),
    });
  });

  it('should list pulse metrics for given metric IDs', async () => {
    mocks.mockListPulseMetricsFromMetricIds.mockResolvedValue(mockPulseMetrics);
    const result = await getToolResult({
      metricIds: ['CF32DDCC-362B-4869-9487-37DA4D152552', 'CF32DDCC-362B-4869-9487-37DA4D152553'],
    });
    expect(result.isError).toBe(false);
    expect(mocks.mockListPulseMetricsFromMetricIds).toHaveBeenCalledWith([
      'CF32DDCC-362B-4869-9487-37DA4D152552',
      'CF32DDCC-362B-4869-9487-37DA4D152553',
    ]);
    const parsedValue = JSON.parse(result.content[0].text as string);
    expect(parsedValue).toEqual(mockPulseMetrics);
  });

  it('should require a non-empty metricIds array with valid IDs', async () => {
    mocks.mockListPulseMetricsFromMetricIds.mockRejectedValue({
      errorCode: '-32602',
      message:
        'Invalid arguments for tool list-pulse-metrics-from-metric-ids: Each ID must be a 36-character string. "path": "metricIds"',
    });
    const result = await getToolResult({ metricIds: [''] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('metricIds');
    expect(result.content[0].text).toContain(
      'Invalid arguments for tool list-pulse-metrics-from-metric-ids',
    );
    expect(result.content[0].text).toContain('36-character string');
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockListPulseMetricsFromMetricIds.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({
      metricIds: ['CF32DDCC-362B-4869-9487-37DA4D152552', 'CF32DDCC-362B-4869-9487-37DA4D152553'],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(errorMessage);
  });
});

async function getToolResult(params: { metricIds: string[] }): Promise<CallToolResult> {
  const listPulseMetricsFromMetricIdsTool = getListPulseMetricsFromMetricIdsTool(new Server());
  return await listPulseMetricsFromMetricIdsTool.callback(params, {
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  });
}
