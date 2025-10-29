import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodiosError } from '@zodios/core';
import { Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import {
  Datasource,
  Query,
  QueryOutput,
  TableauError,
} from '../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { Server } from '../../server.js';
import { getVizqlDataServiceDisabledError } from '../getVizqlDataServiceDisabledError.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { Tool } from '../tool.js';
import { getDatasourceCredentials } from './datasourceCredentials.js';
import { handleQueryDatasourceError } from './queryDatasourceErrorHandler.js';
import { validateQuery } from './queryDatasourceValidator.js';
import { queryDatasourceToolDescription } from './queryDescription.js';
import { validateFilterValues } from './validators/validateFilterValues.js';

type Datasource = z.infer<typeof Datasource>;

const paramsSchema = {
  datasourceLuid: z.string().nonempty(),
  query: Query,
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
      type: 'filter-validation';
      message: string;
    }
  | {
      type: 'tableau-error';
      error: z.infer<typeof TableauError>;
    };

export const getQueryDatasourceTool = (server: Server): Tool<typeof paramsSchema> => {
  const queryDatasourceTool = new Tool({
    server,
    name: 'query-datasource',
    description: queryDatasourceToolDescription,
    paramsSchema,
    annotations: {
      title: 'Query Datasource',
      readOnlyHint: true,
      openWorldHint: false,
    },
    argsValidator: validateQuery,
    callback: async ({ datasourceLuid, query }, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();
      return await queryDatasourceTool.logAndExecute<QueryOutput, QueryDatasourceError>({
        requestId,
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
            callback: async (restApi) => {
              if (!config.disableQueryDatasourceFilterValidation) {
                // Validate filters values for SET and MATCH filters
                const filterValidationResult = await validateFilterValues(
                  server,
                  query,
                  restApi.vizqlDataServiceMethods,
                  datasource,
                );

                if (filterValidationResult.isErr()) {
                  const errors = filterValidationResult.error;
                  const errorMessage = errors.map((error) => error.message).join('\n\n');
                  return new Err({
                    type: 'filter-validation',
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
            case 'filter-validation':
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
