import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err } from 'ts-results-es';
import z from 'zod';

import { ArgsValidationError, DatasourceNotAllowedError } from '../../../../errors/mcpToolError.js';
import { log } from '../../../../logging/logger.js';
import { useRestApi } from '../../../../restApiInstance.js';
import { RestApi } from '../../../../sdks/tableau/restApi.js';
import {
  pulseBundleRequestSchema,
  PulseBundleResponse,
  pulseInsightBundleTypeEnum,
} from '../../../../sdks/tableau/types/pulse.js';
import { WebMcpServer } from '../../../../server.web.js';
import { isAxiosError } from '../../../../utils/axios.js';
import { WebTool } from '../../tool.js';
import {
  applyFieldNameResolution,
  buildFieldNameByCaption,
  resolveIdTypeFromContentUrl,
  WorkbookDatasourceIdType,
} from '../resolveBundleRequestFieldNames.js';
import { validateBundleRequest } from '../validatePulsePayload.js';

const paramsSchema = {
  bundleRequest: pulseBundleRequestSchema,
  bundleType: z.optional(z.enum(pulseInsightBundleTypeEnum)),
};

export const getGeneratePulseMetricValueInsightBundleTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const generatePulseMetricValueInsightBundleTool = new WebTool({
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
    - The \`datasource\` field under \`metric.definition\` requires an \`id\` (datasource LUID). An optional \`id_type\` may also be set, but it does not need to be — this tool automatically detects embedded workbook datasources and sets \`id_type\` accordingly.
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
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ bundleRequest, bundleType }, extra): Promise<CallToolResult> => {
      return await generatePulseMetricValueInsightBundleTool.logAndExecute<PulseBundleResponse>({
        extra,
        args: { bundleRequest, bundleType },
        callback: async () => {
          const validationError = validateBundleRequest(bundleRequest);
          if (validationError) {
            return new ArgsValidationError(validationError).toErr();
          }

          const configWithOverrides = await extra.getConfigWithOverrides();

          const { datasourceIds } = configWithOverrides.boundedContext;
          if (datasourceIds) {
            const datasourceLuid =
              bundleRequest.bundle_request.input.metric.definition.datasource.id;

            if (!datasourceIds.has(datasourceLuid)) {
              const message =
                'The set of allowed metric insights that can be queried is limited by the server configuration. One or more messages in the request contain only metrics derived from data sources that are not in the allowed set.';
              return new DatasourceNotAllowedError(message).toErr();
            }
          }

          const result = await useRestApi({
            ...extra,
            jwtScopes: generatePulseMetricValueInsightBundleTool.requiredApiScopes,
            callback: async (restApi) =>
              await restApi.pulseMethods.generatePulseMetricValueInsightBundle(
                await resolveBundleRequestFieldNames(restApi, bundleRequest),
                bundleType ?? 'ban',
              ),
          });

          return result;
        },
        constrainSuccessResult: (insightBundle) => {
          return {
            type: 'success',
            result: insightBundle,
          };
        },
      });
    },
  });

  return generatePulseMetricValueInsightBundleTool;
};

// The Insight Service validates every `field` string against HBI metadata's
// fieldName, not fieldCaption. Callers build bundleRequest from field captions
// (that's all getDatasourceMetadata exposes), so a calculated field's caption
// (e.g. "Amount_Billions") 400s while its underlying fieldName (e.g.
// "Calculation_00...") succeeds. VDS readMetadata returns both, so resolve
// caption -> fieldName here before forwarding to Pulse. Best-effort: if
// metadata can't be read, forward the request unchanged rather than blocking
// the call — this is a caption/fieldName workaround, not a hard dependency.
//
// Separately, Pulse must always call HBI directly (never a cached query
// result) for embedded/workbook datasources, which requires
// id_type: 'DATASOURCE_ID_TYPE_WORKBOOK_DATASOURCE' on the request. Callers
// can't be relied on to set this themselves, so determine it here: a LUID
// that queryDatasource (the published Datasources REST API) doesn't
// recognize is an embedded workbook datasource.
async function resolveBundleRequestFieldNames(
  restApi: RestApi,
  bundleRequest: z.infer<typeof pulseBundleRequestSchema>,
): Promise<z.infer<typeof pulseBundleRequestSchema>> {
  const datasource = bundleRequest.bundle_request.input.metric.definition.datasource;
  const datasourceLuid = datasource.id;

  const [metadataResult, idType] = await Promise.all([
    // readMetadata only returns Err for a 404 ('feature-disabled'); any other
    // failure (auth, 5xx, network) throws. Catch it here too so a metadata
    // outage forwards the request unchanged instead of failing the whole call.
    restApi.vizqlDataServiceMethods
      .readMetadata({ datasource: { datasourceLuid } })
      .catch((error): Err<'feature-disabled'> => {
        log({
          message: `readMetadata failed for datasource ${datasourceLuid}; forwarding field captions unchanged`,
          level: 'warning',
          logger: 'pulse',
          data: error,
        });
        return Err('feature-disabled');
      }),
    resolveDatasourceIdType(restApi, datasourceLuid),
  ]);

  const fieldNameByCaption = metadataResult.isOk()
    ? buildFieldNameByCaption(metadataResult.value.data ?? [])
    : new Map<string, string>();

  return applyFieldNameResolution(bundleRequest, fieldNameByCaption, idType);
}

// The Datasources REST API returns an entry for embedded/workbook datasources
// too (it doesn't 404), but marks them with a contentUrl of the form
// '$embedded$_<workbookLuid>' instead of a normal published contentUrl. A
// LUID the API genuinely doesn't recognize (404) is treated the same way,
// since Pulse's HBI-direct, uncached path is the safer default for an
// unknown ID. Any other failure (auth, 5xx, network) can't distinguish
// published from embedded either, so it defaults the same way, but is logged
// separately since it's an operational problem rather than an expected case.
async function resolveDatasourceIdType(
  restApi: RestApi,
  datasourceLuid: string,
): Promise<WorkbookDatasourceIdType | undefined> {
  try {
    const datasource = await restApi.datasourcesMethods.queryDatasource({
      siteId: restApi.siteId,
      datasourceId: datasourceLuid,
    });
    return resolveIdTypeFromContentUrl(datasource.contentUrl);
  } catch (error) {
    const isNotFound = isAxiosError(error) && error.response?.status === 404;
    if (!isNotFound) {
      log({
        message: `queryDatasource failed for datasource ${datasourceLuid} with a non-404 error; defaulting to DATASOURCE_ID_TYPE_WORKBOOK_DATASOURCE since published/embedded status could not be verified`,
        level: 'warning',
        logger: 'pulse',
        data: error,
      });
    }
    return 'DATASOURCE_ID_TYPE_WORKBOOK_DATASOURCE';
  }
}
