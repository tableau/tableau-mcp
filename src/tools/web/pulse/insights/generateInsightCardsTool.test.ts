import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { WebMcpServer } from '../../../../server.web.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getGenerateInsightCardsTool } from './generateInsightCardsTool.js';

const mocks = vi.hoisted(() => ({
  mockListDatasources: vi.fn(),
  mockQueryDatasource: vi.fn(),
  mockReadMetadata: vi.fn(),
  mockGenerateBundle: vi.fn(),
  mockIsDatasourceAllowed: vi.fn(),
}));

vi.mock('../../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      siteId: 'test-site-id',
      datasourcesMethods: {
        listDatasources: mocks.mockListDatasources,
        queryDatasource: mocks.mockQueryDatasource,
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

vi.mock('../../resourceAccessChecker.js', () => ({
  resourceAccessChecker: {
    isDatasourceAllowed: mocks.mockIsDatasourceAllowed,
  },
}));

describe('getGenerateInsightCardsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockIsDatasourceAllowed.mockResolvedValue({ allowed: true });
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

  it('extracts the full insight-detail payload from the detail bundle', async () => {
    mocks.mockListDatasources.mockResolvedValue({
      datasources: [{ id: 'ds-luid', name: 'GUS Work', contentUrl: 'GUS-Work' }],
    });
    mocks.mockReadMetadata.mockResolvedValue(
      Ok({
        data: [
          { fieldCaption: 'Created Date', dataType: 'DATE' },
          { fieldCaption: 'Cases', dataType: 'INTEGER' },
          { fieldCaption: 'Region', dataType: 'STRING' },
          { fieldCaption: 'Segment', dataType: 'STRING' },
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
                        relative_to_average: 3,
                        typical_delta_percent: 4,
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
                      markup:
                        'West is running 2.4× its own 6-quarter norm — the largest regional swing this year.',
                      facts: { deviation_factor: 2.4, baseline_window: '6-quarter' },
                      viz: {
                        data: {
                          values: [
                            {
                              truncDate: '2026-06-01T00:00:00Z',
                              formattedTruncDate: 'Jun 1',
                              rawValue: 100,
                              ci0: 90,
                              ci1: 110,
                              dashed: false,
                            },
                            {
                              truncDate: '2026-06-02T00:00:00Z',
                              formattedTruncDate: 'Jun 2',
                              rawValue: 120,
                              ci0: 95,
                              ci1: 130,
                              dashed: false,
                            },
                            {
                              truncDate: '2026-07-01T00:00:00Z',
                              formattedTruncDate: 'Jul 1',
                              rawValue: 'null',
                              ci0: 'null',
                              ci1: 'null',
                              dashed: true,
                            },
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
                  {
                    insight_type: 'topdrivers',
                    result: {
                      type: 'topdrivers',
                      version: 1,
                      question: 'Where is the change most pronounced?',
                      score: 1,
                      viz: {
                        data: {
                          values: [
                            { dimensionLabel: 'West', deltaPercent: 21 },
                            { dimensionLabel: 'East', deltaPercent: 8 },
                            { dimensionLabel: 'Central', deltaPercent: -3 },
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

    // Allowed dimensions surface on the response; the card's primary dimension
    // is the first one (used by the UI to build member-filter drills).
    expect(parsed.dimensions).toEqual(['Region', 'Segment']);
    expect(parsed.cards[0].breakdownDimension).toBe('Region');

    // Block 1: period-over-period comparison.
    expect(parsed.cards[0].comparison).toEqual({
      current: { label: 'Jul 2026', subLabel: 'Jul 1 – 9, 2026', value: 2200, formatted: '2.2K' },
      prior: { label: 'Jun 2026', subLabel: 'Jun 1 – 9, 2026', value: 1964, formatted: '2.0K' },
    });

    // Block 2: trailing-average context line.
    expect(parsed.cards[0].context).toBe('3× the trailing average of +4%');

    // Anchor time series.
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

    // Block 3: top contributing factors (breakdown + share of lift).
    expect(parsed.cards[0].breakdown).toEqual([
      { label: 'West', value: 900 },
      { label: 'East', value: 600 },
      { label: 'Central', value: 300 },
    ]);
    expect(parsed.cards[0].contributors).toEqual([
      { label: 'West', value: 900, formatted: '900', sharePct: 50 },
      { label: 'East', value: 600, formatted: '600', sharePct: 33 },
      { label: 'Central', value: 300, formatted: '300', sharePct: 17 },
    ]);

    // Block 4: where it's most / least pronounced.
    expect(parsed.cards[0].pronounced).toEqual({
      strongest: { label: 'West', value: 21, formatted: '+21%' },
      weakest: { label: 'Central', value: -3, formatted: '-3%' },
    });

    // Block 5: what's unusual.
    expect(parsed.cards[0].unusual).toEqual({
      text: 'West is running 2.4× its own 6-quarter norm — the largest regional swing this year.',
      factor: 2.4,
      baselineWindow: '6-quarter',
    });

    // Block 6: suggested follow-ups (top driver + dimensions).
    expect(parsed.cards[0].followUps).toEqual([
      "What's driving West?",
      'Compare across Region',
      'Break down by Segment',
    ]);

    // Block 7: available actions (static button set).
    expect(parsed.cards[0].actions).toEqual([
      { id: 'drill', label: 'Drill into this', primary: true },
      { id: 'filter-top-driver', label: 'Filter to top driver', primary: false },
      { id: 'build-viz', label: 'Build a viz from this', primary: false },
    ]);
  });

  it('threads drill params (breakdownDimension + filters) into the bundle request', async () => {
    mocks.mockListDatasources.mockResolvedValue({
      datasources: [{ id: 'ds-luid', name: 'GUS Work', contentUrl: 'GUS-Work' }],
    });
    mocks.mockReadMetadata.mockResolvedValue(
      Ok({
        data: [
          { fieldCaption: 'Created Date', dataType: 'DATE' },
          { fieldCaption: 'Cases', dataType: 'INTEGER' },
          { fieldCaption: 'Region', dataType: 'STRING' },
          { fieldCaption: 'Segment', dataType: 'STRING' },
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
                      facts: { formatted_current_value: '2.2K', delta_percent: 12 },
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

    const result = await getToolResult({
      datasource: 'GUS-Work',
      breakdownDimension: 'Segment',
      filters: [{ field: 'Region', value: 'West' }],
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);

    // The full dimension list is returned (so drilled cards can still offer
    // "break down by <other>" follow-ups), while the drill scopes the *active*
    // breakdown to the requested dimension.
    expect(parsed.dimensions).toEqual(['Region', 'Segment']);
    expect(parsed.cards[0].breakdownDimension).toBe('Segment');

    const req = parsed.cards[0].briefConfig.args.bundleRequest.bundle_request.input.metric;
    expect(req.extension_options.allowed_dimensions).toEqual(['Segment']);
    // Member filters scope the metric instance (metric_specification), using the
    // live Pulse contract: OPERATOR_EQUAL + string_value only.
    expect(req.metric_specification.filters).toEqual([
      {
        field: 'Region',
        operator: 'OPERATOR_EQUAL',
        categorical_values: [{ string_value: 'West' }],
      },
    ]);
    expect(req.definition.basic_specification.filters).toEqual([]);
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

  it('denies an out-of-context datasource before any metadata / Insight Service call, with no existence oracle', async () => {
    mocks.mockListDatasources.mockResolvedValue({
      datasources: [{ id: 'ds-luid', name: 'GUS Work', contentUrl: 'GUS-Work' }],
    });
    mocks.mockIsDatasourceAllowed.mockResolvedValue({ allowed: false, message: 'nope' });
    const denied = await getToolResult({ datasource: 'GUS-Work' });

    // Absent contentUrl (no rows) — must be indistinguishable from the denial.
    mocks.mockListDatasources.mockResolvedValue({ datasources: [] });
    mocks.mockIsDatasourceAllowed.mockResolvedValue({ allowed: true });
    const absent = await getToolResult({ datasource: 'GUS-Work' });

    expect(denied.isError).toBe(true);
    expect(absent.isError).toBe(true);
    invariant(denied.content[0].type === 'text');
    invariant(absent.content[0].type === 'text');
    expect(denied.content[0].text).toContain('Could not resolve datasource');
    expect(denied.content[0].text).toBe(absent.content[0].text);
    // The guard runs before any governed read.
    expect(mocks.mockReadMetadata).not.toHaveBeenCalled();
    expect(mocks.mockGenerateBundle).not.toHaveBeenCalled();
  });

  it('gates a denied { luid } input before any identity lookup (no queryDatasource / readMetadata / bundle)', async () => {
    mocks.mockIsDatasourceAllowed.mockResolvedValue({ allowed: false, message: 'nope' });

    const result = await getToolResult({ datasource: { luid: 'ds-luid' } });
    expect(result.isError).toBe(true);
    expect(mocks.mockIsDatasourceAllowed).toHaveBeenCalledWith(
      expect.objectContaining({ datasourceLuid: 'ds-luid' }),
    );
    expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
    expect(mocks.mockReadMetadata).not.toHaveBeenCalled();
    expect(mocks.mockGenerateBundle).not.toHaveBeenCalled();
  });

  it('surfaces the bundle error when every measure fails (no silent empty result)', async () => {
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
    const { PulseInsightsApiError } = await import('../../../../errors/mcpToolError.js');
    mocks.mockGenerateBundle.mockResolvedValue(
      new PulseInsightsApiError('Invalid request', 400).toErr(),
    );

    const result = await getToolResult({ datasource: 'GUS-Work' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Invalid request');
  });

  it('rejects a breakdownDimension that is not a categorical field', async () => {
    mocks.mockListDatasources.mockResolvedValue({
      datasources: [{ id: 'ds-luid', name: 'GUS Work', contentUrl: 'GUS-Work' }],
    });
    mocks.mockReadMetadata.mockResolvedValue(
      Ok({
        data: [
          { fieldCaption: 'Created Date', dataType: 'DATE' },
          { fieldCaption: 'Cases', dataType: 'INTEGER' },
          { fieldCaption: 'Status', dataType: 'STRING' },
        ],
      }),
    );

    const result = await getToolResult({
      datasource: 'GUS-Work',
      breakdownDimension: 'Nonexistent Field',
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('is not a categorical field');
    expect(mocks.mockGenerateBundle).not.toHaveBeenCalled();
  });

  it('selects the same fields regardless of VDS metadata order (deterministic)', async () => {
    const metadata = [
      { fieldCaption: 'Order Date', dataType: 'DATE' },
      { fieldCaption: 'Ship Date', dataType: 'DATETIME' },
      { fieldCaption: 'Sales', dataType: 'REAL' },
      { fieldCaption: 'Quantity', dataType: 'INTEGER' },
      { fieldCaption: 'Profit', dataType: 'REAL' },
      { fieldCaption: 'Region', dataType: 'STRING' },
    ];
    const genericBundle = Ok({
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
                    markup: 'up 5%',
                    facts: { delta_percent: 5 },
                  },
                },
              ],
            },
          ],
          has_errors: false,
          characterization: 'CHARACTERIZATION_UNSPECIFIED',
        },
      },
    });

    const run = async (
      md: Array<{ fieldCaption: string; dataType: string }>,
    ): Promise<{ measures: string[]; timeField: string | undefined; dimensions: string[] }> => {
      mocks.mockListDatasources.mockResolvedValue({
        datasources: [{ id: 'ds', name: 'DS', contentUrl: 'DS' }],
      });
      mocks.mockReadMetadata.mockResolvedValue(Ok({ data: md }));
      mocks.mockGenerateBundle.mockResolvedValue(genericBundle);
      const result = await getToolResult({ datasource: 'DS', maxCards: 2 });
      invariant(result.content[0].type === 'text');
      const parsed = JSON.parse(result.content[0].text);
      return {
        measures: parsed.cards.map((card: { measure: string }) => card.measure),
        timeField: parsed.cards[0]?.timeField,
        dimensions: parsed.dimensions,
      };
    };

    const inOrder = await run(metadata);
    const shuffled = await run([...metadata].reverse());

    expect(inOrder).toEqual(shuffled);
    // Deterministic alphabetical selection (independent of response order).
    expect(inOrder.measures).toEqual(['Profit', 'Quantity']);
    expect(inOrder.timeField).toBe('Order Date');
    expect(inOrder.dimensions).toEqual(['Region']);
  });
});

async function getToolResult(
  params: {
    datasource: string | { luid: string };
    maxCards?: number;
    measures?: string[];
    breakdownDimension?: string;
    filters?: Array<{ field: string; value: string }>;
  } = {
    datasource: 'GUS-Work',
  },
): Promise<CallToolResult> {
  const tool = getGenerateInsightCardsTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      datasource: params.datasource,
      maxCards: params.maxCards,
      measures: params.measures,
      timeField: undefined,
      breakdownDimension: params.breakdownDimension,
      filters: params.filters,
    },
    getMockRequestHandlerExtra(),
  );
}
