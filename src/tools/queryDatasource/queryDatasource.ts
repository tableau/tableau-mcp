import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  ArgsValidationError,
  DatasourceNotAllowedError,
  FeatureDisabledError,
  QueryValidationError,
  ZodiosValidationError,
} from '../../errors/mcpToolError.js';
import { useRestApi } from '../../restApiInstance.js';
import {
  Datasource,
  QueryOutput,
  QueryRequest,
  querySchema,
} from '../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { ProductVersion } from '../../sdks/tableau/types/serverInfo.js';
import { Server } from '../../server.js';
import { getExceptionMessage } from '../../utils/getExceptionMessage.js';
import { getResultForTableauVersion } from '../../utils/isTableauVersionAtLeast.js';
import { Provider } from '../../utils/provider.js';
import { getVizqlDataServiceDisabledError } from '../getVizqlDataServiceDisabledError.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { Tool, ToolRules } from '../tool.js';
import { getDatasourceCredentials } from './datasourceCredentials.js';
import { queryDatasourceToolDescription20253 } from './descriptions/queryDescription.2025.3.js';
import { queryDatasourceToolDescription20261 } from './descriptions/queryDescription.2026.1.js';
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
  datasourceLuid: z.string().nonempty(),
  query: querySchema,
  limit: z.number().int().min(1).optional(),
};

type QueryDatasourceResult = QueryOutput & {
  mcp?: {
    warnings: ContextFilterWarning[];
  };
};

export const getQueryDatasourceTool = (
  server: Server,
  tableauServerVersion: ProductVersion,
): Tool<typeof paramsSchema> => {
  const rules = getQueryDatasourceRules(tableauServerVersion);
  const queryDatasourceTool = new Tool({
    server,
    name: 'query-datasource',
    description: new Provider(() =>
      getResultForTableauVersion({
        productVersion: tableauServerVersion,
        mappings: {
          '2026.1.0': queryDatasourceToolDescription20261,
          '2025.3.0': queryDatasourceToolDescription20253,
          default: queryDatasourceToolDescription,
        },
      }),
    ),
    paramsSchema,
    annotations: {
      title: 'Query Datasource',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ datasourceLuid, query, limit }, extra): Promise<CallToolResult> => {
      const { getConfigWithOverrides } = extra;
      return await queryDatasourceTool.logAndExecute<QueryDatasourceResult>({
        extra,
        args: { datasourceLuid, query },
        callback: async () => {
          try {
            validateQuery({ datasourceLuid, query, rules });
          } catch (error) {
            return Err(new ArgsValidationError(getExceptionMessage(error)));
          }
          const configWithOverrides = await getConfigWithOverrides();
          const isDatasourceAllowedResult = await resourceAccessChecker.isDatasourceAllowed({
            datasourceLuid,
            extra,
          });

          if (!isDatasourceAllowedResult.allowed) {
            return Err(new DatasourceNotAllowedError(isDatasourceAllowedResult.message));
          }

          const datasource: Datasource = { datasourceLuid };
          const maxResultLimit = configWithOverrides.getMaxResultLimit(queryDatasourceTool.name);
          const rowLimit = maxResultLimit
            ? Math.min(maxResultLimit, limit ?? Number.MAX_SAFE_INTEGER)
            : limit;

          const options: QueryRequest['options'] = {
            returnFormat: 'OBJECTS',
            debug: true,
            disaggregate: false,
            ...(rules.dontSpecifyRowLimits ? {} : { rowLimit }),
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
                );

                if (metadataValidationResult.isErr()) {
                  const errors = metadataValidationResult.error;
                  const errorMessage = errors.map((error) => error.message).join('\n\n');
                  return new Err(new QueryValidationError(errorMessage));
                }

                // Validate filters values for SET and MATCH filters
                const filterValidationResult = await validateFilterValues(
                  server,
                  query,
                  restApi.vizqlDataServiceMethods,
                  datasource,
                );

                if (filterValidationResult.isErr()) {
                  const errors = filterValidationResult.error;
                  const errorMessage = errors.map((error) => error.message).join(', ');
                  return new Err(new QueryValidationError(errorMessage));
                }
              }

              const contextWarnings = validateContextFilters(query);

              const result = await restApi.vizqlDataServiceMethods.queryDatasource(queryRequest);
              if (result.isErr()) {
                const vdsError = result.error;
                if (vdsError.type === 'feature-disabled') {
                  return Err(new FeatureDisabledError(getVizqlDataServiceDisabledError()));
                }
                if (vdsError.type === 'zodios-error') {
                  return Err(new ZodiosValidationError(vdsError.error));
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

              if (rowLimit && result.value.data && result.value.data.length > rowLimit) {
                result.value.data.length = rowLimit;
              }

              if (contextWarnings.length > 0) {
                return new Ok({
                  ...result.value,
                  mcp: {
                    warnings: contextWarnings,
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

function getQueryDatasourceRules(tableauServerVersion: ProductVersion): ToolRules {
  return getResultForTableauVersion({
    productVersion: tableauServerVersion,
    mappings: {
      '2026.1.0': {},
      default: {
        dontSpecifyRowLimits: true,
        restrictFunctionsAndCalculationsInFilters: true,
      },
    },
  });
}
