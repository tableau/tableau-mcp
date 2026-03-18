import { pulseInsightBriefResponseSchema } from '../../../../src/sdks/tableau/types/pulse';
import { expect, test } from './base';
import { getSuperstoreDatasource, getTableauMcpPulseDefinition } from './testEnv';

test.describe('generate-pulse-insight-brief', () => {
  // This test requires Tableau AI to be enabled on the site
  test('generate pulse insight brief', async ({ client }) => {
    const superstore = getSuperstoreDatasource();
    const definition = getTableauMcpPulseDefinition();

    const pulseInsightBrief = await client.callTool('generate-pulse-insight-brief', {
      schema: pulseInsightBriefResponseSchema,
      toolArgs: {
        briefRequest: {
          language: 'LANGUAGE_EN_US',
          locale: 'LOCALE_EN_US',
          messages: [
            {
              action_type: 'ACTION_TYPE_SUMMARIZE',
              content: 'What are the key insights for Tableau MCP?',
              role: 'ROLE_USER',
              metric_group_context: [
                {
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
                      is_running_total: false,
                    },
                    metric_specification: {
                      filters: [],
                      measurement_period: {
                        granularity: 'GRANULARITY_BY_MONTH',
                        range: 'RANGE_CURRENT_PARTIAL',
                      },
                      comparison: {
                        comparison: 'TIME_COMPARISON_PREVIOUS_PERIOD',
                      },
                    },
                    extension_options: {
                      allowed_dimensions: ['Region', 'Category'],
                      allowed_granularities: ['GRANULARITY_BY_DAY', 'GRANULARITY_BY_MONTH'],
                      offset_from_today: 0,
                    },
                    representation_options: {
                      type: 'NUMBER_FORMAT_TYPE_NUMBER',
                      number_units: {
                        singular_noun: 'dollar',
                        plural_noun: 'dollars',
                      },
                      sentiment_type: 'SENTIMENT_TYPE_NONE',
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
                      currency_code: 'CURRENCY_CODE_USD',
                    },
                    insights_options: {
                      settings: [
                        { type: 'INSIGHT_TYPE_TOP_DRIVERS', disabled: false },
                        { type: 'INSIGHT_TYPE_METRIC_FORECAST', disabled: false },
                      ],
                    },
                    candidates: [],
                  },
                },
              ],
              metric_group_context_resolved: true,
            },
          ],
        },
      },
    });

    expect(pulseInsightBrief).toBeDefined();
  });
});
