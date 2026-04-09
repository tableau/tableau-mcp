import { pulseBundleResponseSchema } from '../../../../src/sdks/tableau/types/pulse';
import { expect, test } from './base';
import { getSuperstoreDatasource, getTableauMcpPulseDefinition } from './testEnv';

test.describe('generate-pulse-metric-value-insight-bundle', () => {
  test('generate pulse metric value insight bundle', async ({ client }) => {
    const superstore = getSuperstoreDatasource();
    const definition = getTableauMcpPulseDefinition();

    const pulseMetricValueInsightBundle = await client.callTool(
      'generate-pulse-metric-value-insight-bundle',
      {
        schema: pulseBundleResponseSchema,
        toolArgs: {
          bundleRequest: {
            bundle_request: {
              version: 1,
              options: {
                output_format: 'OUTPUT_FORMAT_HTML',
                time_zone: 'UTC',
                language: 'LANGUAGE_EN_US',
                locale: 'LOCALE_EN_US',
              },
              input: {
                metadata: {
                  name: 'Tableau MCP',
                  metric_id: definition.metrics[0].id,
                  definition_id: definition.id,
                },
                metric: {
                  definition: {
                    datasource: {
                      id: superstore.id,
                    },
                    basic_specification: {
                      measure: {
                        field: 'Profit',
                        aggregation: 'AGGREGATION_SUM',
                      },
                      time_dimension: {
                        field: 'Order Date',
                      },
                      filters: [],
                    },
                    is_running_total: true,
                  },
                  metric_specification: {
                    filters: [],
                    measurement_period: {
                      granularity: 'GRANULARITY_BY_MONTH',
                      range: 'RANGE_CURRENT_PARTIAL',
                    },
                    comparison: {
                      comparison: 'TIME_COMPARISON_YEAR_AGO_PERIOD',
                    },
                  },
                  extension_options: {
                    allowed_dimensions: ['City'],
                    allowed_granularities: [
                      'GRANULARITY_BY_DAY',
                      'GRANULARITY_BY_WEEK',
                      'GRANULARITY_BY_MONTH',
                      'GRANULARITY_BY_QUARTER',
                      'GRANULARITY_BY_YEAR',
                    ],
                    offset_from_today: 0,
                    correlation_candidate_definition_ids: [],
                    use_dynamic_offset: false,
                  },
                  representation_options: {
                    type: 'NUMBER_FORMAT_TYPE_NUMBER',
                    number_units: {
                      singular_noun: '',
                      plural_noun: '',
                    },
                    sentiment_type: 'SENTIMENT_TYPE_NONE',
                    row_level_id_field: {
                      identifier_col: '',
                      identifier_label: '',
                    },
                    row_level_entity_names: {
                      entity_name_singular: '',
                      entity_name_plural: '',
                    },
                    row_level_name_field: {
                      name_col: '',
                    },
                    currency_code: 'CURRENCY_CODE_USD',
                  },
                  insights_options: {
                    show_insights: true,
                    settings: [
                      {
                        type: 'INSIGHT_TYPE_RISKY_MONOPOLY',
                        disabled: false,
                      },
                      {
                        type: 'INSIGHT_TYPE_TOP_DRIVERS',
                        disabled: false,
                      },
                      {
                        type: 'INSIGHT_TYPE_CURRENT_TREND',
                        disabled: false,
                      },
                      {
                        type: 'INSIGHT_TYPE_BOTTOM_CONTRIBUTORS',
                        disabled: false,
                      },
                      {
                        type: 'INSIGHT_TYPE_TOP_DETRACTORS',
                        disabled: false,
                      },
                      {
                        type: 'INSIGHT_TYPE_NEW_TREND',
                        disabled: false,
                      },
                      {
                        type: 'INSIGHT_TYPE_UNUSUAL_CHANGE',
                        disabled: false,
                      },
                      {
                        type: 'INSIGHT_TYPE_RECORD_LEVEL_OUTLIERS',
                        disabled: true,
                      },
                      {
                        type: 'INSIGHT_TYPE_CORRELATED_METRIC',
                        disabled: false,
                      },
                      {
                        type: 'INSIGHT_TYPE_METRIC_FORECAST',
                        disabled: false,
                      },
                      {
                        type: 'INSIGHT_TYPE_PACE_TO_GOAL',
                        disabled: false,
                      },
                      {
                        type: 'INSIGHT_TYPE_TOP_CONTRIBUTORS',
                        disabled: false,
                      },
                    ],
                  },
                  candidates: [],
                },
              },
            },
          },
        },
      },
    );

    expect(pulseMetricValueInsightBundle).toBeDefined();
  });
});
