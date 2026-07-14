import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { WebMcpServer } from '../../../../server.web.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getGenerateChironInsightCardsTool } from './generateChironInsightCardsTool.js';

const mocks = vi.hoisted(() => ({
  mockListDatasources: vi.fn(),
  mockReadMetadata: vi.fn(),
  mockGenerateBundle: vi.fn(),
}));

vi.mock('../../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      siteId: 'test-site-id',
      datasourcesMethods: {
        listDatasources: mocks.mockListDatasources,
      },
      vizqlDataServiceMethods: {
        readMetadata: mocks.mockReadMetadata,
      },
      pulseMethods: {
        generatePulseMetricValueInsightBundle: mocks.mockGenerateBundle,
      },
    }),
  ),
}));

describe('getGenerateChironInsightCardsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses headline and delta from bundle facts', async () => {
    mocks.mockListDatasources.mockResolvedValue({
      datasources: [{ id: 'ds-luid', name: 'GUS Work', contentUrl: 'GUS-Work' }],
    });
    mocks.mockReadMetadata.mockResolvedValue(
      Ok({
        data: [
          { fieldCaption: 'Created Date', dataType: 'DATE' },
          { fieldCaption: 'Cases', dataType: 'INTEGER' },
        ],
      }),
    );
    mocks.mockGenerateBundle.mockResolvedValue(
      Ok({
        bundle_response: {
          result: {
            insight_groups: [
              {
                type: 'ban',
                summaries: [],
                insights: [
                  {
                    insight_type: 'popc',
                    result: {
                      type: 'popc',
                      version: 1,
                      question: '',
                      score: 1,
                      markup: 'Cases are up 12%',
                      facts: {
                        formatted_current_value: '2.2K',
                        delta_percent: 12,
                      },
                    },
                  },
                ],
              },
            ],
            has_errors: false,
            characterization: 'CHARACTERIZATION_UNSPECIFIED',
          },
        },
      }),
    );

    const result = await getToolResult();
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.cards[0].headline).toBe('2.2K');
    expect(parsed.cards[0].deltaPct).toBe(12);
    expect(parsed.cards[0].direction).toBe('up');
  });

  it('extracts time series and breakdown from the detail bundle', async () => {
    mocks.mockListDatasources.mockResolvedValue({
      datasources: [{ id: 'ds-luid', name: 'GUS Work', contentUrl: 'GUS-Work' }],
    });
    mocks.mockReadMetadata.mockResolvedValue(
      Ok({
        data: [
          { fieldCaption: 'Created Date', dataType: 'DATE' },
          { fieldCaption: 'Cases', dataType: 'INTEGER' },
        ],
      }),
    );
    mocks.mockGenerateBundle.mockResolvedValue(
      Ok({
        bundle_response: {
          result: {
            insight_groups: [
              {
                type: 'ban',
                summaries: [],
                insights: [
                  {
                    insight_type: 'popc',
                    result: {
                      type: 'popc',
                      version: 1,
                      question: '',
                      score: 1,
                      markup: 'Cases are up 12%',
                      facts: {
                        formatted_current_value: '2.2K',
                        delta_percent: 12,
                        target_period_value: { raw: 2200, formatted: '2.2K' },
                        comparison_period_value: { raw: 1964, formatted: '2.0K' },
                        target_time_period: { label: 'Jul 2026', range: 'Jul 1 – 9, 2026' },
                        comparison_time_period: { label: 'Jun 2026', range: 'Jun 1 – 9, 2026' },
                      },
                    },
                  },
                ],
              },
              {
                type: 'anchor',
                insights: [
                  {
                    insight_type: 'unusualchange',
                    result: {
                      type: 'unusualchange',
                      version: 1,
                      question: 'Is this change unexpected?',
                      score: 1,
                      viz: {
                        data: {
                          values: [
                            { truncDate: '2026-06-01T00:00:00Z', formattedTruncDate: 'Jun 1', rawValue: 100, ci0: 90, ci1: 110, dashed: false },
                            { truncDate: '2026-06-02T00:00:00Z', formattedTruncDate: 'Jun 2', rawValue: 120, ci0: 95, ci1: 130, dashed: false },
                            { truncDate: '2026-07-01T00:00:00Z', formattedTruncDate: 'Jul 1', rawValue: 'null', ci0: 'null', ci1: 'null', dashed: true },
                          ],
                        },
                      },
                    },
                  },
                ],
                summaries: [],
              },
              {
                type: 'breakdown',
                insights: [
                  {
                    insight_type: 'topcontributors',
                    result: {
                      type: 'topcontributors',
                      version: 1,
                      question: 'Which dimensions contributed most?',
                      score: 1,
                      viz: {
                        data: {
                          values: [
                            { dimensionLabel: 'West', value: 900 },
                            { dimensionLabel: 'East', value: 600 },
                            { dimensionLabel: 'Central', value: 300 },
                          ],
                        },
                      },
                    },
                  },
                ],
                summaries: [],
              },
            ],
            has_errors: false,
            characterization: 'CHARACTERIZATION_UNSPECIFIED',
          },
        },
      }),
    );

    const result = await getToolResult();
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.cards[0].briefConfig.args.bundleType).toBe('detail');

    expect(parsed.cards[0].comparison).toEqual({
      current: { label: 'Jul 2026', subLabel: 'Jul 1 – 9, 2026', value: 2200, formatted: '2.2K' },
      prior: { label: 'Jun 2026', subLabel: 'Jun 1 – 9, 2026', value: 1964, formatted: '2.0K' },
    });

    expect(parsed.cards[0].series).toHaveLength(3);
    expect(parsed.cards[0].series[0]).toEqual({
      date: '2026-06-01T00:00:00Z',
      label: 'Jun 1',
      value: 100,
      lower: 90,
      upper: 110,
      dashed: false,
    });
    // "null" string coerces to null and dashed flag is preserved.
    expect(parsed.cards[0].series[2].value).toBeNull();
    expect(parsed.cards[0].series[2].dashed).toBe(true);

    expect(parsed.cards[0].breakdown).toEqual([
      { label: 'West', value: 900 },
      { label: 'East', value: 600 },
      { label: 'Central', value: 300 },
    ]);
  });

  it('parses delta direction from markup when facts omit percentage', async () => {
    mocks.mockListDatasources.mockResolvedValue({
      datasources: [{ id: 'ds-luid', name: 'GUS Work', contentUrl: 'GUS-Work' }],
    });
    mocks.mockReadMetadata.mockResolvedValue(
      Ok({
        data: [
          { fieldCaption: 'Created Date', dataType: 'DATE' },
          { fieldCaption: 'Cases', dataType: 'INTEGER' },
        ],
      }),
    );
    mocks.mockGenerateBundle.mockResolvedValue(
      Ok({
        bundle_response: {
          result: {
            insight_groups: [
              {
                type: 'ban',
                summaries: [],
                insights: [
                  {
                    insight_type: 'popc',
                    result: {
                      type: 'popc',
                      version: 1,
                      question: '',
                      score: 1,
                      markup: 'Cases were down 3.9% compared to prior period.',
                      facts: {
                        formatted_current_value: '193',
                      },
                    },
                  },
                ],
              },
            ],
            has_errors: false,
            characterization: 'CHARACTERIZATION_UNSPECIFIED',
          },
        },
      }),
    );

    const result = await getToolResult();
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.cards[0].deltaPct).toBe(-3.9);
    expect(parsed.cards[0].direction).toBe('down');
  });

  it('returns no_data card when bundle markup says no data', async () => {
    mocks.mockListDatasources.mockResolvedValue({
      datasources: [{ id: 'ds-luid', name: 'Superstore', contentUrl: 'Superstore' }],
    });
    mocks.mockReadMetadata.mockResolvedValue(
      Ok({
        data: [
          { fieldCaption: 'Order Date', dataType: 'DATE' },
          { fieldCaption: 'Sales', dataType: 'REAL' },
        ],
      }),
    );
    mocks.mockGenerateBundle.mockResolvedValue(
      Ok({
        bundle_response: {
          result: {
            insight_groups: [
              {
                type: 'ban',
                summaries: [],
                insights: [
                  {
                    insight_type: 'popc',
                    result: {
                      type: 'popc',
                      version: 1,
                      question: '',
                      score: 1,
                      markup: 'No data available for this period',
                      facts: {},
                    },
                  },
                ],
              },
            ],
            has_errors: false,
            characterization: 'CHARACTERIZATION_UNSPECIFIED',
          },
        },
      }),
    );

    const result = await getToolResult({ datasource: 'Superstore' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.cards[0].direction).toBe('no_data');
    expect(parsed.cards[0].deltaPct).toBeNull();
  });
});

async function getToolResult(
  params: { datasource: string | { luid: string }; maxCards?: number } = {
    datasource: 'GUS-Work',
  },
): Promise<CallToolResult> {
  const tool = getGenerateChironInsightCardsTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      datasource: params.datasource,
      maxCards: params.maxCards,
      measures: undefined,
      timeField: undefined,
    },
    getMockRequestHandlerExtra(),
  );
}
