import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { getConfig } from '../../../config.js';
import type { PulseMetricSubscription } from '../../../sdks/tableau/types/pulse.js';
import { Server } from '../../../server.js';
import invariant from '../../../utils/invariant.js';
import { mockPulseMetricDefinitions } from '../mockPulseMetricDefinitions.js';
import {
  constrainPulseMetricSubscriptions,
  getListPulseMetricSubscriptionsTool,
} from './listPulseMetricSubscriptions.js';

const mockPulseMetrics = mockPulseMetricDefinitions.flatMap((definition) => definition.metrics);

const mockPulseMetricSubscriptions: PulseMetricSubscription[] = [
  { id: '2FDE35F3-602E-43D9-981A-A2A5AC1DE7BD', metric_id: mockPulseMetrics[0].id },
  { id: '2FDE35F3-602E-43D9-981A-A2A5AC1DE7BE', metric_id: mockPulseMetrics[2].id },
];

const mocks = vi.hoisted(() => ({
  mockListPulseMetricSubscriptionsForCurrentUser: vi.fn(),
  mockListPulseMetricsFromMetricIds: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      pulseMethods: {
        listPulseMetricSubscriptionsForCurrentUser:
          mocks.mockListPulseMetricSubscriptionsForCurrentUser,
        listPulseMetricsFromMetricIds: mocks.mockListPulseMetricsFromMetricIds,
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

  describe('constrainPulseMetricSubscriptions', () => {
    const restApiArgs = { config: getConfig(), requestId: 'request-id', server: getServer() };

    it('should return empty result when no subscriptions are found', async () => {
      const result = await constrainPulseMetricSubscriptions({
        subscriptions: [],
        boundedContext: { projectIds: null, datasourceIds: null, workbookIds: null },
        restApiArgs,
      });

      invariant(result.type === 'empty');
      expect(result.message).toBe(
        'No Pulse Metric Subscriptions were found. Either none exist or you do not have permission to view them.',
      );
    });

    it('should return empty results when all subscriptions were filtered out by the bounded context', async () => {
      mocks.mockListPulseMetricsFromMetricIds.mockResolvedValue(
        new Ok([mockPulseMetrics[0], mockPulseMetrics[1]]),
      );

      const result = await constrainPulseMetricSubscriptions({
        subscriptions: mockPulseMetricSubscriptions,
        boundedContext: { projectIds: null, datasourceIds: new Set(['123']), workbookIds: null },
        restApiArgs,
      });

      invariant(result.type === 'empty');
      expect(result.message).toBe(
        [
          'The set of allowed Pulse Metric Subscriptions that can be queried is limited by the server configuration.',
          'While Pulse Metric Subscriptions were found, they were all filtered out by the server configuration.',
        ].join(' '),
      );
    });

    it('should return success result when no subscriptions were filtered out by the bounded context', async () => {
      mocks.mockListPulseMetricsFromMetricIds.mockResolvedValue(
        new Ok([mockPulseMetrics[0], mockPulseMetrics[1]]),
      );

      const result = await constrainPulseMetricSubscriptions({
        subscriptions: mockPulseMetricSubscriptions,
        boundedContext: { projectIds: null, datasourceIds: null, workbookIds: null },
        restApiArgs,
      });

      invariant(result.type === 'success');
      expect(result.result).toBe(mockPulseMetricSubscriptions);
    });

    it('should return success result when some subscriptions were filtered out by the bounded context', async () => {
      mocks.mockListPulseMetricsFromMetricIds.mockResolvedValue(
        new Ok([mockPulseMetrics[0], mockPulseMetrics[1]]),
      );

      const result = await constrainPulseMetricSubscriptions({
        subscriptions: mockPulseMetricSubscriptions,
        boundedContext: {
          projectIds: null,
          datasourceIds: new Set([mockPulseMetrics[0].datasource_luid]),
          workbookIds: null,
        },
        restApiArgs,
      });

      invariant(result.type === 'success');
      expect(result.result).toEqual([mockPulseMetricSubscriptions[0]]);
    });
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

function getServer(): InstanceType<typeof Server> {
  const server = new Server();
  server.tool = vi.fn();
  return server;
}
