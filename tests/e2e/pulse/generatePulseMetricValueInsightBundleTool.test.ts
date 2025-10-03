import { pulseBundleResponseSchema } from '../../../src/sdks/tableau/types/pulse.js';
import { getPulseDefinition } from '../../constants.js';
import { getDefaultEnv, getSuperstoreDatasource, resetEnv, setEnv } from '../../testEnv.js';
import { callTool } from '../client.js';

describe('generate-pulse-metric-value-insight-bundle', () => {
  beforeAll(setEnv);
  afterAll(resetEnv);

  it('should list all pulse metric definitions', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreDatasource(env);
    const tableauMcpDefinition = getPulseDefinition(env.SERVER, env.SITE_NAME, 'Tableau MCP');

    const bundleRequest = {
      bundle_request: {
        version: 1,
        options: {
          output_format: 'OUTPUT_FORMAT_HTML',
          time_zone: 'UTC',
          language: 'LANGUAGE_EN_US',
          locale: 'LOCALE_EN_US',
        } as const,
        input: {
          metadata: {
            name: 'Pulse Metric',
            metric_id: tableauMcpDefinition.metrics[0].id,
            definition_id: tableauMcpDefinition.id,
          },
          metric: {
            definition: {
              datasource: { id: superstore.id },
              basic_specification: {
                measure: { field: 'Sales', aggregation: 'AGGREGATION_SUM' },
                time_dimension: { field: 'Order Date' },
                filters: [],
              },
              is_running_total: false,
            },
            metric_specification: {
              filters: [],
              measurement_period: {
                granularity: 'GRANULARITY_BY_QUARTER',
                range: 'RANGE_LAST_COMPLETE',
              },
              comparison: {
                comparison: 'TIME_COMPARISON_PREVIOUS_PERIOD',
              },
            },
            extension_options: {
              allowed_dimensions: [],
              allowed_granularities: [],
              offset_from_today: 0,
            },
            representation_options: {
              type: 'NUMBER_FORMAT_TYPE_NUMBER',
              number_units: {
                singular_noun: 'unit',
                plural_noun: 'units',
              },
              sentiment_type: 'SENTIMENT_TYPE_UNSPECIFIED',
              row_level_id_field: {
                identifier_col: 'Order ID',
                identifier_label: '',
              },
              row_level_entity_names: {
                entity_name_singular: 'Order',
              },
              row_level_name_field: {
                name_col: 'Order Name',
              },
              currency_code: 'CURRENCY_CODE_USD',
            },
            insights_options: {
              show_insights: true,
              settings: [],
            },
            goals: {
              target: {
                value: 100,
              },
            },
          },
        },
      },
    };

    const bundle = await callTool('generate-pulse-metric-value-insight-bundle', {
      env,
      schema: pulseBundleResponseSchema,
      toolArgs: {
        bundleRequest,
        bundleType: 'ban',
      },
    });

    expect(bundle.bundle_response.result.insight_groups.length).toBeGreaterThan(0);
  });
});
