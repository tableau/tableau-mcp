import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { PulseDisabledError, PulseNotAvailableError } from '../../../../errors/mcpToolError.js';
import * as loggerModule from '../../../../logging/logger.js';
import { WebMcpServer } from '../../../../server.web.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { mockPulseMetricDefinitions } from '../mockPulseMetricDefinitions.js';
import { getListPulseMetricsFromMetricDefinitionIdTool } from './listPulseMetricsFromMetricDefinitionId.js';

const mocks = vi.hoisted(() => ({
  mockListPulseMetricsFromMetricDefinitionId: vi.fn(),
}));

vi.mock('../../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      pulseMethods: {
        listPulseMetricsFromMetricDefinitionId: mocks.mockListPulseMetricsFromMetricDefinitionId,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

beforeEach(() => {
  vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
});

describe('TEST-PULSEPAGE-TOOL: listPulseMetricsFromMetricDefinitionIdTool', () => {
  const mockPulseMetrics = mockPulseMetricDefinitions.flatMap((definition) => definition.metrics);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const listPulseMetricsFromMetricDefinitionIdTool =
      getListPulseMetricsFromMetricDefinitionIdTool(new WebMcpServer());
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
    mocks.mockListPulseMetricsFromMetricDefinitionId.mockResolvedValue(
      new Ok({ metrics: mockPulseMetrics, pagination: {} }),
    );
    const result = await getToolResult({
      pulseMetricDefinitionID: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
    });
    expect(result.isError).toBe(false);
    expect(mocks.mockListPulseMetricsFromMetricDefinitionId).toHaveBeenCalledWith(
      'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
      undefined,
      undefined,
      undefined,
      expect.any(AbortSignal),
    );
    invariant(result.content[0].type === 'text');
    const parsedValue = JSON.parse(result.content[0].text);
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
    invariant(result.content[0].type === 'text');
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
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  it.each([12, 77, 23])(
    'returns all %i metric IDs across default-sized REST pages',
    async (count) => {
      const metrics = Array.from({ length: count }, (_, index) => ({
        ...mockPulseMetrics[0],
        id: `metric-${index}`,
      }));
      mocks.mockListPulseMetricsFromMetricDefinitionId.mockImplementation(
        async (_definitionId, token) => {
          const offset = token ? Number(token) : 0;
          const next = offset + 10;
          return new Ok({
            metrics: metrics.slice(offset, next),
            pagination: {
              total_available: count,
              next_page_token: next < count ? String(next) : '',
            },
          });
        },
      );
      const result = await getToolResult({
        pulseMetricDefinitionID: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
      });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(JSON.parse(result.content[0].text)).toEqual(metrics);
      expect(mocks.mockListPulseMetricsFromMetricDefinitionId).toHaveBeenCalledTimes(
        Math.ceil(count / 10),
      );
    },
  );

  it.each([false, true])(
    'forwards page size and follower setting %s on every page',
    async (exclude) => {
      mocks.mockListPulseMetricsFromMetricDefinitionId
        .mockResolvedValueOnce(
          new Ok({ metrics: [mockPulseMetrics[0]], pagination: { next_page_token: 'opaque/+&=' } }),
        )
        .mockResolvedValueOnce(new Ok({ metrics: [mockPulseMetrics[1]], pagination: {} }));
      const result = await getToolResult({
        pulseMetricDefinitionID: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
        pageSize: 1,
        excludeMetricsWithoutFollowers: exclude,
      });
      expect(result.isError).toBe(false);
      for (const [index, token] of [undefined, 'opaque/+&='].entries()) {
        expect(mocks.mockListPulseMetricsFromMetricDefinitionId).toHaveBeenNthCalledWith(
          index + 1,
          'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
          token,
          1,
          exclude,
          expect.any(AbortSignal),
        );
      }
    },
  );

  it.each([
    { serverLimit: undefined, callerLimit: 3, expected: 3 },
    { serverLimit: '2', callerLimit: 3, expected: 2 },
    { serverLimit: '3', callerLimit: 2, expected: 2 },
    { serverLimit: '2', callerLimit: undefined, expected: 2 },
  ])(
    'applies caller/server limits $serverLimit/$callerLimit',
    async ({ serverLimit, callerLimit, expected }) => {
      if (serverLimit) vi.stubEnv('MAX_RESULT_LIMIT', serverLimit);
      mocks.mockListPulseMetricsFromMetricDefinitionId.mockResolvedValue(
        new Ok({
          metrics: Array.from({ length: 10 }, () => mockPulseMetrics[0]),
          pagination: { next_page_token: 'unused', total_available: 77 },
        }),
      );
      const result = await getToolResult({
        pulseMetricDefinitionID: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
        limit: callerLimit,
      });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(JSON.parse(result.content[0].text)).toHaveLength(expected);
      expect(mocks.mockListPulseMetricsFromMetricDefinitionId).toHaveBeenCalledTimes(1);
    },
  );

  it('applies the per-tool configured result limit', async () => {
    vi.stubEnv('MAX_RESULT_LIMITS', 'list-pulse-metrics-from-metric-definition-id:2');
    mocks.mockListPulseMetricsFromMetricDefinitionId.mockResolvedValue(
      new Ok({ metrics: Array.from({ length: 10 }, () => mockPulseMetrics[0]), pagination: {} }),
    );
    const result = await getToolResult({
      pulseMetricDefinitionID: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
      limit: 5,
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toHaveLength(2);
  });

  it('retains datasource restrictions for metrics from every page', async () => {
    vi.stubEnv('INCLUDE_DATASOURCE_IDS', mockPulseMetrics[0].datasource_luid);
    const allowed = { ...mockPulseMetrics[0], id: 'allowed-later-page' };
    mocks.mockListPulseMetricsFromMetricDefinitionId
      .mockResolvedValueOnce(
        new Ok({
          metrics: [
            { ...mockPulseMetrics[0], id: 'private-first-page', datasource_luid: 'denied' },
          ],
          pagination: { next_page_token: 'next' },
        }),
      )
      .mockResolvedValueOnce(new Ok({ metrics: [allowed], pagination: {} }));
    const result = await getToolResult({
      pulseMetricDefinitionID: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual([allowed]);
    expect(JSON.stringify(result)).not.toContain('private-first-page');
  });

  it.each(['throw', 'disabled'])(
    'fails instead of returning partial success after a later-page %s',
    async (kind) => {
      mocks.mockListPulseMetricsFromMetricDefinitionId.mockResolvedValueOnce(
        new Ok({ metrics: [mockPulseMetrics[0]], pagination: { next_page_token: 'next' } }),
      );
      if (kind === 'throw') {
        mocks.mockListPulseMetricsFromMetricDefinitionId.mockRejectedValueOnce(
          new Error('later page failed'),
        );
      } else {
        mocks.mockListPulseMetricsFromMetricDefinitionId.mockResolvedValueOnce(
          new PulseDisabledError().toErr(),
        );
      }
      const result = await getToolResult({
        pulseMetricDefinitionID: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(
        kind === 'throw' ? 'later page failed' : 'Pulse is disabled',
      );
      expect(result.content[0].text).not.toContain(mockPulseMetrics[0].id);
    },
  );

  it.each([
    { limit: 0 },
    { limit: -1 },
    { limit: 1.5 },
    { pageSize: 0 },
    { pageSize: -1 },
    { pageSize: 1.5 },
    { excludeMetricsWithoutFollowers: 'false' },
  ])('rejects invalid pagination/filter input %j', async (invalid) => {
    const tool = getListPulseMetricsFromMetricDefinitionIdTool(new WebMcpServer());
    expect(
      z.object(await Provider.from(tool.paramsSchema)).safeParse({
        pulseMetricDefinitionID: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
        ...invalid,
      }).success,
    ).toBe(false);
  });

  it('stops before requesting another page when the request is cancelled', async () => {
    const controller = new AbortController();
    mocks.mockListPulseMetricsFromMetricDefinitionId.mockImplementationOnce(async () => {
      controller.abort();
      return new Ok({ metrics: [mockPulseMetrics[0]], pagination: { next_page_token: 'next' } });
    });
    const result = await getToolResult(
      {
        pulseMetricDefinitionID: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
      },
      getMockRequestHandlerExtra({ signal: controller.signal }),
    );
    expect(result.isError).toBe(true);
    expect(mocks.mockListPulseMetricsFromMetricDefinitionId).toHaveBeenCalledTimes(1);
  });

  it('should return an error when executing the tool against Tableau Server', async () => {
    mocks.mockListPulseMetricsFromMetricDefinitionId.mockResolvedValue(
      new PulseNotAvailableError().toErr(),
    );
    const result = await getToolResult({
      pulseMetricDefinitionID: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Pulse is not available on Tableau Server.');
  });

  it('should return an error when Pulse is disabled', async () => {
    mocks.mockListPulseMetricsFromMetricDefinitionId.mockResolvedValue(
      new PulseDisabledError().toErr(),
    );
    const result = await getToolResult({
      pulseMetricDefinitionID: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Pulse is disabled on this Tableau Cloud site.');
  });
});

async function getToolResult(
  params: {
    pulseMetricDefinitionID: string;
    limit?: number;
    pageSize?: number;
    excludeMetricsWithoutFollowers?: boolean;
  },
  extra = getMockRequestHandlerExtra(),
): Promise<CallToolResult> {
  const listPulseMetricsFromMetricDefinitionIdTool = getListPulseMetricsFromMetricDefinitionIdTool(
    new WebMcpServer(),
  );
  const callback = await Provider.from(listPulseMetricsFromMetricDefinitionIdTool.callback);
  return await callback(
    { limit: undefined, pageSize: undefined, excludeMetricsWithoutFollowers: undefined, ...params },
    extra,
  );
}
