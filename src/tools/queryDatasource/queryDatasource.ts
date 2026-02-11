import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodiosError } from '@zodios/core';
import { Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import {
  Datasource,
  QueryOutput,
  querySchema,
  TableauError,
} from '../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { Server } from '../../server.js';
import { getTableauAuthInfo } from '../../server/oauth/getTableauAuthInfo.js';
import { TableauAuthInfo } from '../../server/oauth/schemas.js';
import { getRequiredApiScopesForTool } from '../../server/oauth/scopes.js';
import { createProductTelemetryBase } from '../../telemetry/productTelemetry/telemetryForwarder.js';
import { getResultForTableauVersion } from '../../utils/isTableauVersionAtLeast.js';
import { Provider } from '../../utils/provider.js';
import { getVizqlDataServiceDisabledError } from '../getVizqlDataServiceDisabledError.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { Tool } from '../tool.js';
import { getDatasourceCredentials } from './datasourceCredentials.js';
import { handleQueryDatasourceError } from './queryDatasourceErrorHandler.js';
import { validateQuery } from './queryDatasourceValidator.js';
import { queryDatasourceToolDescription20253 } from './queryDescription.2025.3.js';
import { queryDatasourceToolDescription } from './queryDescription.js';
import { validateFilterValues } from './validators/validateFilterValues.js';
import { validateQueryAgainstDatasourceMetadata } from './validators/validateQueryAgainstDatasourceMetadata.js';

const paramsSchema = {
  datasourceLuid: z.string().nonempty(),
  query: querySchema,
  limit: z.number().int().min(1).optional(),
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
  authInfo?: TableauAuthInfo,
): Tool<typeof paramsSchema> => {
  const config = getConfig();

  const queryDatasourceTool = new Tool({
    server,
    name: 'query-datasource',
    description: new Provider(
      async () =>
        await getResultForTableauVersion({
          server: config.server || authInfo?.server,
          mappings: {
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
    argsValidator: validateQuery,
    callback: async (
      { datasourceLuid, query, limit },
      { requestId, sessionId, authInfo, signal },
    ): Promise<CallToolResult> => {
      return await queryDatasourceTool.logAndExecute<QueryOutput, QueryDatasourceError>({
        requestId,
        sessionId,
        authInfo,
        args: { datasourceLuid, query },
        callback: async () => {
          const isDatasourceAllowedResult = await resourceAccessChecker.isDatasourceAllowed({
            datasourceLuid,
            restApiArgs: { config, requestId, server, signal },
          });

          if (!isDatasourceAllowedResult.allowed) {
            return new Err({
              type: 'datasource-not-allowed',
              message: isDatasourceAllowedResult.message,
            });
          }

          const datasource: Datasource = { datasourceLuid };
          const maxResultLimit = config.getMaxResultLimit(queryDatasourceTool.name);
          const rowLimit = maxResultLimit
            ? Math.min(maxResultLimit, limit ?? Number.MAX_SAFE_INTEGER)
            : limit;

          const options = await getResultForTableauVersion({
            server: config.server || getTableauAuthInfo(authInfo)?.server,
            mappings: {
              '2026.1.0': {
                returnFormat: 'OBJECTS',
                debug: true,
                disaggregate: false,
                rowLimit, // rowLimit can only be provided in 2026.1.0 and later
              } as const,
              default: {
                returnFormat: 'OBJECTS',
                debug: true,
                disaggregate: false,
              } as const,
            },
          });

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
            config,
            requestId,
            server,
            jwtScopes: getRequiredApiScopesForTool('query-datasource'),
            signal,
            authInfo: getTableauAuthInfo(authInfo),
            callback: async (restApi) => {
              if (!config.disableQueryDatasourceValidationRequests) {
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
        productTelemetryBase: createProductTelemetryBase(config, authInfo),
      });
    },
  });

  return queryDatasourceTool;
};
