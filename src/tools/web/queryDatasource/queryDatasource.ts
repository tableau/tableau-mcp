import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  ArgsValidationError,
  DatasourceNotAllowedError,
  FeatureDisabledError,
  QueryValidationError,
  WorkbookDatasourceNotEnabledError,
  ZodiosValidationError,
} from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import {
  Datasource,
  QueryOutput,
  QueryRequest,
  querySchema,
} from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { ProductVersion } from '../../../sdks/tableau/types/serverInfo.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { getResultForTableauVersion } from '../../../utils/isTableauVersionAtLeast.js';
import { Provider } from '../../../utils/provider.js';
import { buildTruncationInfo, MAX_INT32, TruncationReason } from '../_lib/truncation.js';
import {
  getEmbeddedDatasourceVersionHint,
  getVizqlDataServiceDisabledError,
} from '../getVizqlDataServiceDisabledError.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { ToolRules, WebTool } from '../tool.js';
import { getDatasourceCredentials } from './datasourceCredentials.js';
import { queryDatasourceToolDescription20253 } from './descriptions/queryDescription.2025.3.js';
import { queryDatasourceToolDescription20261 } from './descriptions/queryDescription.2026.1.js';
import { queryDatasourceToolDescription20263 } from './descriptions/queryDescription.2026.3.js';
import { queryDatasourceToolDescription } from './descriptions/queryDescription.js';
import { handleQueryDatasourceError } from './queryDatasourceErrorHandler.js';
import { validateQuery } from './queryDatasourceValidator.js';
import {
  ContextFilterWarning,
  validateContextFilters,
} from './validators/validateContextFilters.js';
import { validateFilterValues } from './validators/validateFilterValues.js';
import { validateQueryAgainstDatasourceMetadata } from './validators/validateQueryAgainstDatasourceMetadata.js';

const paramsSchema = {
  datasourceLuid: luidSchema,
  workbookLuid: luidSchema
    .optional()
    .describe(
      'Required to access an embedded (workbook) data source: the LUID of the workbook it belongs to, e.g. the workbook LUID passed to get-workbook. Omit for published data sources.',
    ),
  query: querySchema,
  interpretFieldCaptionsAsFieldNames: z
    .boolean()
    .optional()
    .describe(
      'Requires Tableau 2025.3 or later. Set true to query using exact fieldName and parameterName values from get-datasource-metadata. Use this for duplicate display names, choosing the intended logical table. In this mode use internal names consistently in fields, filters, calculations and parameters; do not invent names. Omit or set false to use display captions.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    // VDS's rowLimit width is unverified; keep limit + 1 within int32.
    .max(MAX_INT32 - 1)
    .optional()
    .describe(
      "Max rows to return. When a row limit applies (this or a server cap), mcp.resultInfo.truncated says whether more rows matched; truncationReason 'admin-cap' means a server cap cut them — narrow filters or aggregate.",
    ),
};

const fieldNameParamsSchema = z.object(paramsSchema);
// Preserve hidden arguments so unsupported calls reach the runtime version guard.
const captionParamsSchema = fieldNameParamsSchema
  .omit({ interpretFieldCaptionsAsFieldNames: true })
  .passthrough();
type QueryDatasourceParamsSchema = z.ZodType<
  z.output<typeof fieldNameParamsSchema>,
  z.ZodTypeDef,
  z.input<typeof fieldNameParamsSchema>
>;

type QueryDatasourceResult = QueryOutput & {
  mcp?: {
    warnings?: ContextFilterWarning[];
    resultInfo?: {
      returnedCount: number;
      truncated: boolean;
      truncationReason?: TruncationReason;
    };
  };
};

export const getQueryDatasourceTool = (
  server: WebMcpServer,
  productVersion: ProductVersion,
): WebTool<QueryDatasourceParamsSchema> => {
  const rules = getQueryDatasourceRules(productVersion);
  const queryDatasourceTool = new WebTool<QueryDatasourceParamsSchema>({
    server,
    name: 'query-datasource',
    minRequiredRole: SiteRole.VIEWER,
    description: new Provider(() =>
      getResultForTableauVersion({
        productVersion,
        mappings: {
          '2026.3.0': queryDatasourceToolDescription20263,
          '2026.1.0': queryDatasourceToolDescription20261,
          '2025.3.0': queryDatasourceToolDescription20253,
          default: queryDatasourceToolDescription,
        },
      }),
    ),
    paramsSchema: new Provider(() =>
      rules.fieldNamesAreUnavailable ? captionParamsSchema : fieldNameParamsSchema,
    ),
    annotations: {
      title: 'Query Datasource',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { datasourceLuid, workbookLuid, query, limit, interpretFieldCaptionsAsFieldNames },
      extra,
    ): Promise<CallToolResult> => {
      const { getConfigWithOverrides } = extra;
      return await queryDatasourceTool.logAndExecute<QueryDatasourceResult>({
        extra,
        args: { datasourceLuid, workbookLuid, query, interpretFieldCaptionsAsFieldNames },
        callback: async () => {
          if (interpretFieldCaptionsAsFieldNames && rules.fieldNamesAreUnavailable) {
            return new ArgsValidationError(
              'Querying by internal field names requires Tableau 2025.3 or later. Omit interpretFieldCaptionsAsFieldNames or set it to false and use display captions on this server.',
            ).toErr();
          }
          try {
            validateQuery({ datasourceLuid, query, rules });
          } catch (error) {
            return new ArgsValidationError(getExceptionMessage(error)).toErr();
          }
          const configWithOverrides = await getConfigWithOverrides();
          const isDatasourceAllowedResult = await resourceAccessChecker.isDatasourceAllowed({
            datasourceLuid,
            workbookLuid,
            supportsWorkbookLuid: true,
            extra,
          });

          if (!isDatasourceAllowedResult.allowed) {
            return new DatasourceNotAllowedError(isDatasourceAllowedResult.message).toErr();
          }

          const datasource: Datasource = { datasourceLuid };
          const maxResultLimit = configWithOverrides.getMaxResultLimit(queryDatasourceTool.name);
          const rowLimit = maxResultLimit
            ? Math.min(maxResultLimit, limit ?? MAX_INT32 - 1)
            : limit;

          // The extra row tells "exactly rowLimit rows" apart from "more rows matched".
          const options: QueryRequest['options'] = {
            returnFormat: 'OBJECTS',
            debug: true,
            disaggregate: false,
            ...(interpretFieldCaptionsAsFieldNames
              ? { interpretFieldCaptionsAsFieldNames: true }
              : {}),
            ...(rules.dontSpecifyRowLimits || rowLimit === undefined
              ? {}
              : { rowLimit: rowLimit + 1 }),
          };

          const credentials = getDatasourceCredentials(datasourceLuid);
          if (credentials) {
            datasource.connections = credentials;
          }

          const queryRequest = {
            datasource,
            query,
            options,
          };

          return await useRestApi({
            ...extra,
            jwtScopes: queryDatasourceTool.requiredApiScopes,
            callback: async (restApi) => {
              if (!configWithOverrides.disableQueryDatasourceValidationRequests) {
                // Validate query against metadata
                const metadataValidationResult = await validateQueryAgainstDatasourceMetadata(
                  query,
                  restApi.vizqlDataServiceMethods,
                  datasource,
                  interpretFieldCaptionsAsFieldNames,
                );

                if (metadataValidationResult.isErr()) {
                  const errors = metadataValidationResult.error;
                  const errorMessage = errors.map((error) => error.message).join('\n\n');
                  return new QueryValidationError(errorMessage).toErr();
                }

                // Validate filters values for SET and MATCH filters
                const filterValidationResult = await validateFilterValues(
                  server,
                  query,
                  restApi.vizqlDataServiceMethods,
                  datasource,
                  interpretFieldCaptionsAsFieldNames,
                );

                if (filterValidationResult.isErr()) {
                  const errors = filterValidationResult.error;
                  const errorMessage = errors.map((error) => error.message).join(', ');
                  return new QueryValidationError(errorMessage).toErr();
                }
              }

              const contextWarnings = validateContextFilters(query);

              const result = await restApi.vizqlDataServiceMethods.queryDatasource(queryRequest);
              if (result.isErr()) {
                const vdsError = result.error;
                if (vdsError.type === 'feature-disabled') {
                  // Any 404 from the VDS query endpoint maps to feature-disabled. On REST API < 3.30
                  // that 404 can instead mean the target is an embedded datasource (unsupported below
                  // 3.30), so append a hedged hint — the base "enable VDS via TSM" text stays correct
                  // for a genuinely-disabled VDS.
                  const message = RestApi.versionIsAtLeast('3.30')
                    ? getVizqlDataServiceDisabledError()
                    : `${getVizqlDataServiceDisabledError()} ${getEmbeddedDatasourceVersionHint()}`;
                  return new FeatureDisabledError(message).toErr();
                }
                if (vdsError.type === 'workbook-datasource-not-enabled') {
                  return new WorkbookDatasourceNotEnabledError().toErr();
                }
                if (vdsError.type === 'zodios-error') {
                  return new ZodiosValidationError(vdsError.error).toErr();
                }
                return Err(
                  handleQueryDatasourceError(
                    'tableau-error',
                    vdsError.message,
                    vdsError.httpStatus,
                    vdsError.errorCode,
                  ),
                );
              }

              let resultInfo: NonNullable<QueryDatasourceResult['mcp']>['resultInfo'];
              if (rowLimit) {
                const data = result.value.data;
                const truncatedByLimit = !!data && data.length > rowLimit;
                if (data && truncatedByLimit) {
                  data.length = rowLimit;
                }

                resultInfo = {
                  returnedCount: data?.length ?? 0,
                  ...buildTruncationInfo({
                    truncatedByLimit,
                    maxResultLimit,
                    llmLimit: limit,
                    effectiveLimit: rowLimit,
                  }),
                };
              }

              if (contextWarnings.length > 0 || resultInfo) {
                return new Ok({
                  ...result.value,
                  mcp: {
                    ...(contextWarnings.length > 0 && { warnings: contextWarnings }),
                    ...(resultInfo && { resultInfo }),
                  },
                });
              }

              return result;
            },
          });
        },
        constrainSuccessResult: (queryOutput) => {
          return {
            type: 'success',
            result: queryOutput,
          };
        },
      });
    },
  });

  return queryDatasourceTool;
};

function getQueryDatasourceRules(productVersion: ProductVersion): ToolRules {
  return getResultForTableauVersion<ToolRules>({
    productVersion,
    mappings: {
      '2026.1.0': {},
      '2025.3.0': {
        dontSpecifyRowLimits: true,
        restrictFunctionsAndCalculationsInFilters: true,
      },
      default: {
        dontSpecifyRowLimits: true,
        restrictFunctionsAndCalculationsInFilters: true,
        fieldNamesAreUnavailable: true,
      },
    },
  });
}
