import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { PulseInsightsDisabledError } from '../../../../errors/mcpToolError.js';
import { WebMcpServer } from '../../../../server.web.js';
import { stubDefaultEnvVars } from '../../../../testShared.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getGenerateChironInsightFromDatasourceContextTool } from './generateChironInsightFromDatasourceContextTool.js';
import { ChironInsightRequest } from './requestBuilder.js';

const mocks = vi.hoisted(() => ({
  mockGeneratePulseInsightBrief: vi.fn(),
  mockGeneratePulseMetricValueInsightBundle: vi.fn(),
}));

vi.mock('../../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      pulseMethods: {
        generatePulseInsightBrief: mocks.mockGeneratePulseInsightBrief,
        generatePulseMetricValueInsightBundle: mocks.mockGeneratePulseMetricValueInsightBundle,
      },
    }),
  ),
}));

const request: ChironInsightRequest = {
  datasource: {
    id: 'A6FC3C9F-4F40-4906-8DB0-AC70C5FB5A11',
    isPublished: true,
  },
  schema: {
    fields: [
      {
        name: 'Sales',
        role: 'measure',
        dataType: 'number',
        supportedAggregations: ['AGGREGATION_SUM'],
      },
      {
        name: 'Order Date',
        role: 'time',
        dataType: 'date',
      },
      {
        name: 'Region',
        role: 'dimension',
        dataType: 'string',
        allowedFilterValues: ['West', 'East'],
      },
    ],
  },
  context: {
    measureField: 'Sales',
    timeField: 'Order Date',
    dimensionFields: ['Region'],
    filters: [{ field: 'Region', operator: 'OPERATOR_IN', values: ['West'] }],
  },
  insight: {
    mode: 'summary',
    output: 'brief',
  },
  options: {
    aggregation: 'AGGREGATION_SUM',
    granularity: 'GRANULARITY_BY_MONTH',
    range: 'RANGE_CURRENT_PARTIAL',
    comparison: 'TIME_COMPARISON_PREVIOUS_PERIOD',
    language: 'LANGUAGE_EN_US',
    locale: 'LOCALE_EN_US',
    timeZone: 'UTC',
  },
};

describe('getGenerateChironInsightFromDatasourceContextTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  it('registers the expected tool name', () => {
    const tool = getGenerateChironInsightFromDatasourceContextTool(new WebMcpServer());
    expect(tool.name).toBe('generate-chiron-insight-from-datasource-context');
  });

  it('generates a brief and returns provenance with generated request', async () => {
    mocks.mockGeneratePulseInsightBrief.mockResolvedValue(
      new Ok({
        follow_up_questions: [],
        generation_id: 'gen-id',
        group_context: [],
        markup: '<p>summary</p>',
        not_enough_information: false,
        source_insights: [],
      }),
    );

    const result = await getToolResult(request);

    expect(result.isError).toBe(false);
    expect(mocks.mockGeneratePulseInsightBrief).toHaveBeenCalledTimes(1);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.output).toBe('brief');
    expect(payload.generatedRequest).toHaveProperty('messages');
    expect(payload.provenance.datasourceId).toBe(request.datasource.id);
  });

  it('fails before API call for invalid filter values', async () => {
    const result = await getToolResult({
      ...request,
      context: {
        ...request.context,
        filters: [{ field: 'Region', operator: 'OPERATOR_IN', values: ['South'] }],
      },
    });

    expect(result.isError).toBe(true);
    expect(mocks.mockGeneratePulseInsightBrief).not.toHaveBeenCalled();
    expect(mocks.mockGeneratePulseMetricValueInsightBundle).not.toHaveBeenCalled();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Filter value South is not allowed for field Region');
  });

  it('generates bundle output when requested', async () => {
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(
      new Ok({
        bundle_response: {
          result: {
            insight_groups: [],
            has_errors: false,
            characterization: 'CHARACTERIZATION_UNSPECIFIED',
          },
        },
      }),
    );

    const result = await getToolResult({
      ...request,
      insight: {
        mode: 'trend',
        output: 'bundle',
        bundleType: 'detail',
      },
    });

    expect(result.isError).toBe(false);
    expect(mocks.mockGeneratePulseMetricValueInsightBundle).toHaveBeenCalledTimes(1);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.output).toBe('bundle');
    expect(payload.bundleType).toBe('detail');
    expect(payload.generatedRequest).toHaveProperty('bundle_request');
  });

  it('falls back to bundle when the AI brief is disabled on the site', async () => {
    mocks.mockGeneratePulseInsightBrief.mockResolvedValue(new PulseInsightsDisabledError().toErr());
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(
      new Ok({
        bundle_response: {
          result: {
            insight_groups: [],
            has_errors: false,
            characterization: 'CHARACTERIZATION_UNSPECIFIED',
          },
        },
      }),
    );

    // request defaults to output: 'brief'
    const result = await getToolResult(request);

    expect(result.isError).toBe(false);
    expect(mocks.mockGeneratePulseInsightBrief).toHaveBeenCalledTimes(1);
    expect(mocks.mockGeneratePulseMetricValueInsightBundle).toHaveBeenCalledTimes(1);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.output).toBe('bundle');
    expect(payload.fallback).toBe('brief_unavailable_used_bundle');
  });

  async function getToolResult(input: ChironInsightRequest): Promise<CallToolResult> {
    const tool = getGenerateChironInsightFromDatasourceContextTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    return await callback({ request: input }, getMockRequestHandlerExtra());
  }
});
