import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err } from 'ts-results-es';
import z from 'zod';

import { getConfig } from '../../../config.js';
import { useRestApi } from '../../../restApiInstance.js';
import { PulseDisabledError } from '../../../sdks/tableau/methods/pulseMethods.js';
import {
  pulseBundleRequestSchema,
  PulseBundleResponse,
  pulseInsightBundleTypeEnum,
} from '../../../sdks/tableau/types/pulse.js';
import { Server } from '../../../server.js';
import { Tool } from '../../tool.js';
import { getPulseDisabledError } from '../getPulseDisabledError.js';

const paramsSchema = {
  bundleRequest: pulseBundleRequestSchema,
  bundleType: z.optional(z.enum(pulseInsightBundleTypeEnum)),
};

export type GeneratePulseMetricValueInsightBundleError =
  | {
      type: 'feature-disabled';
      reason: PulseDisabledError;
    }
  | {
      type: 'datasource-not-allowed';
      message: string;
    };

export const getGeneratePulseMetricValueInsightBundleTool = (
  server: Server,
): Tool<typeof paramsSchema> => {
  const generatePulseMetricValueInsightBundleTool = new Tool({
    server,
    name: 'generate-pulse-metric-value-insight-bundle',
    description: `
Generate an insight bundle for the current aggregated value for Pulse Metric using Tableau REST API.  You need the full information of the Pulse Metric and Pulse Metric Definition to use this tool.

**Parameters:**
- \`bundleRequest\` (required): The request to generate a bundle for.  Most of the information comes from data returned from other tools that retrieve Pulse Metric and Pulse Metric Definition information.  When creating the bundleRequest, you will need to set options using the following values:
    - output_format: 'OUTPUT_FORMAT_HTML'
    - time_zone: 'UTC'
    - language: 'LANGUAGE_EN_US'
    - locale: 'LOCALE_EN_US'
- \`bundleType\` (optional): The type of bundle to generate.  The default is 'ban'.
  - 'ban' - Return a basic insight bundle with the current aggregated value for the Pulse Metric, period over period change, and the highest ranked insight for each filterable dimension of the metric.
  - 'springboard' - Return a springboard insight bundle with the current value, period over period change, and the highest ranked insight for the metric.
  - 'basic' - Similar to a springboard insight, but data is focused on the dimensions of a metric that are low bandwidth because they have small value sets. It shows the current value, period over period change, and the highest ranked insight for the metric for that data.
  - 'detail' - Shows insights on performance over time of the metric, a summary visualization of metric highs and lows and trends, breakdowns of top contributors for each filterable dimension of the metric, and followup insights based on the top ranked insights not already presented.

**Example Usage:**
- Generate the default insight bundle for the Pulse metric:
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
    },
- Generate the ban insight bundle for the Pulse metric:
    bundleType: 'ban',
    bundleRequest: (See default example above)
- Generate the springboard insight bundle for the Pulse metric:
    bundleType: 'springboard',
    bundleRequest: (See default example above)
- Generate the basic insight bundle for the Pulse metric:
    bundleType: 'basic',
    bundleRequest: (See default example above)
- Generate the detail insight bundle for the Pulse metric:
    bundleType: 'detail',
    bundleRequest: (See default example above)
`,
    paramsSchema,
    annotations: {
      title: 'Generate Pulse Metric Value Insight Bundle',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ bundleRequest, bundleType }, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();
      return await generatePulseMetricValueInsightBundleTool.logAndExecute<
        PulseBundleResponse,
        GeneratePulseMetricValueInsightBundleError
      >({
        requestId,
        args: { bundleRequest, bundleType },
        callback: async () => {
          const { datasourceIds } = config.boundedContext;
          if (datasourceIds) {
            const datasourceLuid =
              bundleRequest.bundle_request.input.metric.definition.datasource.id;

            if (!datasourceIds.has(datasourceLuid)) {
              return new Err({
                type: 'datasource-not-allowed',
                message: [
                  'The set of allowed metric insights that can be queried is limited by the server configuration.',
                  'Generating the Pulse Metric Value Insight Bundle is not allowed because the definition is derived',
                  `from the data source with LUID ${datasourceLuid}, which is not in the allowed set of data sources.`,
                ].join(' '),
              });
            }
          }

          const result = await useRestApi({
            config,
            requestId,
            server,
            jwtScopes: ['tableau:insights:read'],
            callback: async (restApi) =>
              await restApi.pulseMethods.generatePulseMetricValueInsightBundle(
                bundleRequest,
                bundleType ?? 'ban',
              ),
          });

          if (result.isErr()) {
            return new Err({
              type: 'feature-disabled',
              reason: result.error,
            });
          }

          return result;
        },
        constrainSuccessResult: (insightBundle) => {
          return {
            type: 'success',
            result: insightBundle,
          };
        },
        getErrorText: (error) => {
          switch (error.type) {
            case 'feature-disabled':
              return getPulseDisabledError(error.reason);
            case 'datasource-not-allowed':
              return error.message;
          }
        },
      });
    },
  });

  return generatePulseMetricValueInsightBundleTool;
};
