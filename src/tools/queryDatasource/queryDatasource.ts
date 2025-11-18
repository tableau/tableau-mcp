import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodiosError } from '@zodios/core';
import { Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getTableauServerVersion } from '../../getTableauServerVersion.js';
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
import { isTableauVersionAtLeast } from '../../utils/isTableauVersionAtLeast.js';
import { Provider } from '../../utils/provider.js';
import { getVizqlDataServiceDisabledError } from '../getVizqlDataServiceDisabledError.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { Tool } from '../tool.js';
import { getDatasourceCredentials } from './datasourceCredentials.js';
import { handleQueryDatasourceError } from './queryDatasourceErrorHandler.js';
import { validateQuery } from './queryDatasourceValidator.js';
import { queryDatasourceToolDescription } from './queryDescription.js';
import { validateFilterValues } from './validators/validateFilterValues.js';
import { validateQueryAgainstDatasourceMetadata } from './validators/validateQueryAgainstDatasourceMetadata.js';

const paramsSchema = {
  datasourceLuid: z.string().nonempty(),
  query: querySchema,
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
    description: new Provider(async () => {
      const productVersion = await getTableauServerVersion(config.server ?? authInfo?.server);
      if (isTableauVersionAtLeast({ productVersion, minVersion: '2025.3.0' })) {
        return queryDatasourceToolDescription;
      }

      return queryDatasourceToolDescription;
    }),
    paramsSchema,
    annotations: {
      title: 'Query Datasource',
      readOnlyHint: true,
      openWorldHint: false,
    },
    argsValidator: validateQuery,
    callback: async (
      { datasourceLuid, query },
      { requestId, authInfo },
    ): Promise<CallToolResult> => {
      return await queryDatasourceTool.logAndExecute<QueryOutput, QueryDatasourceError>({
        requestId,
        authInfo,
        args: { datasourceLuid, query },
        callback: async () => {
          const isDatasourceAllowedResult = await resourceAccessChecker.isDatasourceAllowed({
            datasourceLuid,
            restApiArgs: { config, requestId, server },
          });

          if (!isDatasourceAllowedResult.allowed) {
            return new Err({
              type: 'datasource-not-allowed',
              message: isDatasourceAllowedResult.message,
            });
          }

          const datasource: Datasource = { datasourceLuid };
          const options = {
            returnFormat: 'OBJECTS',
            debug: true,
            disaggregate: false,
          } as const;

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
            jwtScopes: ['tableau:viz_data_service:read'],
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
