import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { getConfig } from '../../../config.js';
import { getNewRestApiInstanceAsync } from '../../../restApiInstance.js';
import { pulseBundleRequestSchema } from '../../../sdks/tableau/types/pulse.js';
import { Server } from '../../../server.js';
import { Tool } from '../../tool.js';

const paramsSchema = {
  bundleRequest: pulseBundleRequestSchema,
};

export const getGeneratePulseMetricValueInsightBundleTool = (
  server: Server,
): Tool<typeof paramsSchema> => {
  const generatePulseMetricValueInsightBundleTool = new Tool({
    server,
    name: 'generate-pulse-metric-value-insight-bundle',
    description: `
Generate a bundle for the current aggregated value for Pulse Metric using Tableau REST API.  You need the full information of the Pulse Metric and Pulse Metric Definition to use this tool.

**Parameters:**
- \`bundleRequest\` (required): The request to generate a bundle for.  Most of the information comes from data returned from other tools that retrieve Pulse Metric and Pulse Metric Definition information.  When creating the bundleRequest, you will need to set options using the following values:
    - output_format: 'OUTPUT_FORMAT_HTML'
    - time_zone: 'UTC'
    - language: 'LANGUAGE_EN_US'
    - locale: 'LOCALE_EN_US'

**Example Usage:**
- Generate a bundle for the current aggregated value for the Pulse metric:
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
            name: 'Pulse Metric',
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
                  aggregation: 'AGGREGATION_SUM', 
                },
                time_dimension: {
                  field: 'Order Date',
                },
              },
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
`,
    paramsSchema,
    annotations: {
      title: 'Generate Pulse Metric Bundle',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ bundleRequest }, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();
      return await generatePulseMetricValueInsightBundleTool.logAndExecute({
        requestId,
        args: { bundleRequest },
        callback: async () => {
          const restApi = await getNewRestApiInstanceAsync(
            config.server,
            config.authConfig,
            requestId,
            server,
          );
          return new Ok(
            await restApi.pulseMethods.generatePulseMetricValueInsightBundle(bundleRequest),
          );
        },
      });
    },
  });

  return generatePulseMetricValueInsightBundleTool;
};
