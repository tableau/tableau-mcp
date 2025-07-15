import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Datasource, Query, TableauError } from '../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { Tool } from '../tool.js';
import { getDatasourceCredentials } from './datasourceCredentials.js';
import { handleQueryDatasourceError } from './queryDatasourceErrorHandler.js';
import { validateQuery } from './queryDatasourceValidator.js';
import { validateFilterValues } from './validators/validateFilterValues.js';
import { queryDatasourceToolDescription } from './queryDescription.js';

type Datasource = z.infer<typeof Datasource>;

export const queryDatasourceTool = new Tool({
  name: 'query-datasource',
  description: queryDatasourceToolDescription,
  paramsSchema: {
    datasourceLuid: z.string().nonempty(),
    query: Query,
  },
  annotations: {
    title: 'Query Datasource',
    readOnlyHint: true,
    openWorldHint: false,
  },
  argsValidator: validateQuery,
  callback: async ({ datasourceLuid, query }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await queryDatasourceTool.logAndExecute({
      requestId,
      args: { datasourceLuid, query },
      callback: async () => {
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

        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );

        const queryRequest = {
          datasource,
          query,
          options,
        };

        const queryDatasourceResponse = await restApi.vizqlDataServiceMethods.queryDatasource(queryRequest);
        if (queryDatasourceResponse.isOk() && queryDatasourceResponse.value.data?.length === 0) {
          // Validate SET and MATCH filter values before executing the main query
          const filterValidationResult = await validateFilterValues(
            query,
            restApi.vizqlDataServiceMethods,
            datasource
          );

          if (filterValidationResult.isErr()) {
            const errors = filterValidationResult.error;
            const errorMessage = errors.map(error => error.message).join('\n\n');
            throw new Error(errorMessage);
          }
        }

        return queryDatasourceResponse;
      },
      getErrorText: (error: z.infer<typeof TableauError>) => {
        return JSON.stringify({ requestId, ...handleQueryDatasourceError(error) });
      },
    });
  },
});
