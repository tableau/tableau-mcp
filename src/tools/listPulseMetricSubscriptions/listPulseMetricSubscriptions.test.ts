import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { PulseMetricSubscription } from '../../sdks/tableau/apis/pulseApi.js';
import { server } from '../../server.js';
import { listPulseMetricSubscriptionsTool } from './listPulseMetricSubscriptions.js';

// Mock server.server.sendLoggingMessage since the transport won't be connected.
vi.spyOn(server.server, 'sendLoggingMessage').mockImplementation(vi.fn());

const mockPulseMetricSubscriptions: PulseMetricSubscription[] = [
  { id: '2FDE35F3-602E-43D9-981A-A2A5AC1DE7BD', metric_id: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C5' },
  { id: '2FDE35F3-602E-43D9-981A-A2A5AC1DE7BE', metric_id: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C6' },
];

const mocks = vi.hoisted(() => ({
  mockListPulseMetricSubscriptionsForCurrentUser: vi.fn(),
}));

vi.mock('../../restApiInstance.js', () => ({
  getNewRestApiInstanceAsync: vi.fn().mockResolvedValue({
    pulseMethods: {
      listPulseMetricSubscriptionsForCurrentUser:
        mocks.mockListPulseMetricSubscriptionsForCurrentUser,
    },
  }),
}));

describe('listPulseMetricSubscriptionsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    expect(listPulseMetricSubscriptionsTool.name).toBe('list-pulse-metric-subscriptions');
    expect(listPulseMetricSubscriptionsTool.description).toContain(
      'Retrieves a list of published Pulse Metric Subscriptions for the current user',
    );
    expect(listPulseMetricSubscriptionsTool.paramsSchema).toMatchObject({});
  });

  it('should list pulse metric subscriptions for the current user', async () => {
    mocks.mockListPulseMetricSubscriptionsForCurrentUser.mockResolvedValue(
      mockPulseMetricSubscriptions,
    );
    const result = await getToolResult();
    expect(result.isError).toBe(false);
    expect(mocks.mockListPulseMetricSubscriptionsForCurrentUser).toHaveBeenCalled();
    const parsedValue = JSON.parse(result.content[0].text as string);
    expect(parsedValue).toEqual(mockPulseMetricSubscriptions);
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockListPulseMetricSubscriptionsForCurrentUser.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(errorMessage);
  });
});

async function getToolResult(): Promise<CallToolResult> {
  return await listPulseMetricSubscriptionsTool.callback(
    {},
    {
      signal: new AbortController().signal,
      requestId: 'test-request-id',
      sendNotification: vi.fn(),
      sendRequest: vi.fn(),
    },
  );
}
