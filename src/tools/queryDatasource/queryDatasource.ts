import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodiosError } from '@zodios/core';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../restApiInstance.js';
import {
  Datasource,
  QueryOutput,
  QueryRequest,
  querySchema,
  TableauError,
} from '../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { ProductVersion } from '../../sdks/tableau/types/serverInfo.js';
import { Server } from '../../server.js';
import { getRequiredApiScopesForTool } from '../../server/oauth/scopes.js';
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
import { validateQueryWithRules } from './queryDatasourceValidator.js';
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

export type QueryDatasourceError =
  | {
      type: 'feature-disabled';
    }
  | {
      type: 'datasource-not-allowed';
      message: string;
    }
  | {
      type: 'query-validation';
      message: string;
    }
  | {
      type: 'tableau-error';
      error: TableauError;
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
    argsValidator: validateQueryWithRules(rules),
    callback: async ({ datasourceLuid, query, limit }, extra): Promise<CallToolResult> => {
      const { requestId, getConfigWithOverrides } = extra;
      return await queryDatasourceTool.logAndExecute<QueryDatasourceResult, QueryDatasourceError>({
        extra,
        args: { datasourceLuid, query },
        callback: async () => {
          const configWithOverrides = await getConfigWithOverrides();
          const isDatasourceAllowedResult = await resourceAccessChecker.isDatasourceAllowed({
            datasourceLuid,
            extra,
          });

          if (!isDatasourceAllowedResult.allowed) {
            return new Err({
              type: 'datasource-not-allowed',
              message: isDatasourceAllowedResult.message,
            });
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
            jwtScopes: getRequiredApiScopesForTool(queryDatasourceTool.name),
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
                  return new Err({
                    type: 'query-validation',
                    message: errorMessage,
                  });
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
                  return new Err({
                    type: 'query-validation',
                    message: errorMessage,
                  });
                }
              }

              const contextWarnings = validateContextFilters(query);

              const result = await restApi.vizqlDataServiceMethods.queryDatasource(queryRequest);
              if (result.isErr()) {
                return new Err(
                  result.error instanceof ZodiosError
                    ? result.error
                    : result.error === 'feature-disabled'
                      ? { type: 'feature-disabled' }
                      : {
                          type: 'tableau-error',
                          error: result.error,
                        },
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
        getErrorText: (error: QueryDatasourceError) => {
          switch (error.type) {
            case 'feature-disabled':
              return getVizqlDataServiceDisabledError();
            case 'datasource-not-allowed':
              return error.message;
            case 'query-validation':
              return JSON.stringify({
                requestId,
                errorType: 'validation',
                message: error.message,
              });
            case 'tableau-error':
              return JSON.stringify({
                requestId,
                ...handleQueryDatasourceError(error.error),
              });
          }
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
