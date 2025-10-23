import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import type { PulseMetricSubscription } from '../../../sdks/tableau/types/pulse.js';
import { Server } from '../../../server.js';
import { mockPulseMetricDefinitions } from '../mockPulseMetricDefinitions.js';
import { getListPulseMetricSubscriptionsTool } from './listPulseMetricSubscriptions.js';

const mockPulseMetrics = mockPulseMetricDefinitions.flatMap((definition) => definition.metrics);

const mockPulseMetricSubscriptions: PulseMetricSubscription[] = [
  { id: '2FDE35F3-602E-43D9-981A-A2A5AC1DE7BD', metric_id: mockPulseMetrics[0].id },
  { id: '2FDE35F3-602E-43D9-981A-A2A5AC1DE7BE', metric_id: mockPulseMetrics[1].id },
];

const mocks = vi.hoisted(() => ({
  mockListPulseMetricSubscriptionsForCurrentUser: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      pulseMethods: {
        listPulseMetricSubscriptionsForCurrentUser:
          mocks.mockListPulseMetricSubscriptionsForCurrentUser,
      },
    }),
  ),
}));

describe('listPulseMetricSubscriptionsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const listPulseMetricSubscriptionsTool = getListPulseMetricSubscriptionsTool(new Server());
    expect(listPulseMetricSubscriptionsTool.name).toBe('list-pulse-metric-subscriptions');
    expect(listPulseMetricSubscriptionsTool.description).toContain(
      'Retrieves a list of published Pulse Metric Subscriptions for the current user',
    );
    expect(listPulseMetricSubscriptionsTool.paramsSchema).toMatchObject({});
  });

  it('should list pulse metric subscriptions for the current user', async () => {
    mocks.mockListPulseMetricSubscriptionsForCurrentUser.mockResolvedValue(
      new Ok(mockPulseMetricSubscriptions),
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

  it('should return an error when executing the tool against Tableau Server', async () => {
    mocks.mockListPulseMetricSubscriptionsForCurrentUser.mockResolvedValue(
      new Err('tableau-server'),
    );
    const result = await getToolResult();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Pulse is not available on Tableau Server.');
  });

  it('should return an error when Pulse is disabled', async () => {
    mocks.mockListPulseMetricSubscriptionsForCurrentUser.mockResolvedValue(
      new Err('pulse-disabled'),
    );
    const result = await getToolResult();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Pulse is disabled on this Tableau Cloud site.');
  });
});

async function getToolResult(): Promise<CallToolResult> {
  const listPulseMetricSubscriptionsTool = getListPulseMetricSubscriptionsTool(new Server());
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
