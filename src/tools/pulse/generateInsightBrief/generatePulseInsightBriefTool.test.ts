import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { Server } from '../../../server.js';
import { getGeneratePulseInsightBriefTool } from './generatePulseInsightBriefTool.js';

const mocks = vi.hoisted(() => ({
  mockGeneratePulseInsightBrief: vi.fn(),
  mockGetConfig: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      pulseMethods: {
        generatePulseInsightBrief: mocks.mockGeneratePulseInsightBrief,
      },
    }),
  ),
}));

vi.mock('../../../config.js', () => ({
  getConfig: mocks.mockGetConfig,
}));

describe('getGeneratePulseInsightBriefTool', () => {
  const briefRequest = {
    language: 'LANGUAGE_EN_US' as const,
    locale: 'LOCALE_EN_US' as const,
    messages: [
      {
        action_type: 'ACTION_TYPE_SUMMARIZE' as const,
        content: 'What are the key insights for my sales metric?',
        role: 'ROLE_USER' as const,
        metric_group_context: [
          {
            metadata: {
              name: 'Sales Metric',
              metric_id: 'CF32DDCC-362B-4869-9487-37DA4D152552',
              definition_id: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
            },
            metric: {
              definition: {
                datasource: {
                  id: 'A6FC3C9F-4F40-4906-8DB0-AC70C5FB5A11',
                },
                basic_specification: {
                  measure: {
                    field: 'Sales',
                    aggregation: 'AGGREGATION_SUM' as const,
                  },
                  time_dimension: {
                    field: 'Order Date',
                  },
                  filters: [],
                },
                is_running_total: false,
              },
              metric_specification: {
                filters: [],
                measurement_period: {
                  granularity: 'GRANULARITY_BY_MONTH' as const,
                  range: 'RANGE_CURRENT_PARTIAL' as const,
                },
                comparison: {
                  comparison: 'TIME_COMPARISON_PREVIOUS_PERIOD' as const,
                },
              },
              extension_options: {
                allowed_dimensions: [],
                allowed_granularities: [],
                offset_from_today: 0,
              },
              representation_options: {
                type: 'NUMBER_FORMAT_TYPE_NUMBER' as const,
                number_units: {
                  singular_noun: 'dollar',
                  plural_noun: 'dollars',
                },
                sentiment_type: 'SENTIMENT_TYPE_NONE' as const,
                row_level_id_field: {
                  identifier_col: 'Order ID',
                },
                row_level_entity_names: {
                  entity_name_singular: 'Order',
                  entity_name_plural: 'Orders',
                },
                row_level_name_field: {
                  name_col: 'Order Name',
                },
                currency_code: 'CURRENCY_CODE_USD' as const,
              },
              insights_options: {
                settings: [],
              },
            },
          },
        ],
        metric_group_context_resolved: true,
      },
    ],
    now: '2025-11-15 00:00:00',
    time_zone: 'UTC',
  };

  const mockBriefResponse = {
    markup: 'Your sales metric shows strong performance this month with a 15% increase.',
    generation_id: 'test-generation-id',
    source_insights: [
      {
        type: 'trend',
        markup: 'Sales have been trending upward consistently',
      },
    ],
    follow_up_questions: [
      { content: 'What factors contributed to the increase?' },
      { content: 'How does this compare to last year?' },
    ],
    group_context: briefRequest.messages[0].metric_group_context,
    not_enough_information: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockGetConfig.mockReturnValue({
      boundedContext: {
        projectIds: null,
        datasourceIds: null,
        workbookIds: null,
      },
    });
  });

  it('should have correct tool name', () => {
    const tool = getGeneratePulseInsightBriefTool(new Server());
    expect(tool.name).toBe('generate-pulse-insight-brief');
  });

  it('should have correct annotations', () => {
    const tool = getGeneratePulseInsightBriefTool(new Server());
    expect(tool.annotations).toEqual({
      title: 'Generate Pulse Insight Brief',
      readOnlyHint: true,
      openWorldHint: false,
    });
  });

  it('should have brief request in params schema', () => {
    const tool = getGeneratePulseInsightBriefTool(new Server());
    expect(tool.paramsSchema).toHaveProperty('briefRequest');
  });

  it('should call generatePulseInsightBrief with brief request', async () => {
    mocks.mockGeneratePulseInsightBrief.mockResolvedValue(new Ok(mockBriefResponse));
    const result = await getToolResult();
    expect(mocks.mockGeneratePulseInsightBrief).toHaveBeenCalledWith(briefRequest);
    expect(result.isError).toBe(false);
    const parsedValue = JSON.parse(result.content[0].text as string);
    expect(parsedValue).toEqual(mockBriefResponse);
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockGeneratePulseInsightBrief.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should return an error when executing the tool against Tableau Server', async () => {
    mocks.mockGeneratePulseInsightBrief.mockResolvedValue(new Err('tableau-server'));
    const result = await getToolResult();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Pulse is not available on Tableau Server.');
  });

  it('should return an error when Pulse is disabled', async () => {
    mocks.mockGeneratePulseInsightBrief.mockResolvedValue(new Err('pulse-disabled'));
    const result = await getToolResult();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Pulse is disabled on this Tableau Cloud site.');
  });

  it('should return an error when datasource is not in the allowed set', async () => {
    mocks.mockGetConfig.mockReturnValue({
      boundedContext: {
        projectIds: null,
        datasourceIds: new Set(['some-other-datasource-luid']),
        workbookIds: null,
      },
    });
    const result = await getToolResult();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(
      'The set of allowed metric insights that can be queried is limited by the server configuration.',
    );
  });

  async function getToolResult(): Promise<CallToolResult> {
    const tool = getGeneratePulseInsightBriefTool(new Server());
    return await tool.callback(
      { briefRequest },
      {
        signal: new AbortController().signal,
        requestId: 'test-request-id',
        sendNotification: vi.fn(),
        sendRequest: vi.fn(),
      },
    );
  }
});
