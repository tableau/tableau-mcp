import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Query, TableauError } from '../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { Tool } from '../tool.js';
import { handleQueryDatasourceError } from './queryDatasourceErrorHandler.js';
import { validateQuery } from './queryDatasourceValidator.js';
import { queryDatasourceToolDescription } from './queryDescription.js';

export const queryDatasourceTool = new Tool({
  name: 'query-datasource',
  description: queryDatasourceToolDescription,
  paramsSchema: {
    datasourceLuid: z.string(),
    query: Query,
  },
  annotations: {
    title: 'Query Datasource',
    readOnlyHint: true,
    openWorldHint: false,
  },
  argsValidator: validateQuery,
  callback: async ({ datasourceLuid, query }): Promise<CallToolResult> => {
    const config = getConfig();
    return await queryDatasourceTool.logAndExecute({
      args: { datasourceLuid, query },
      callback: async (requestId) => {
        const datasource = { datasourceLuid };
        const options = {
          returnFormat: 'OBJECTS',
          debug: true,
          disaggregate: false,
        } as const;

        const queryRequest = {
          datasource,
          query,
          options,
        };

        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );

        return await restApi.vizqlDataServiceMethods.queryDatasource(queryRequest);
      },
      getErrorText: (requestId: string, error: z.infer<typeof TableauError>) => {
        return JSON.stringify({ requestId, ...handleQueryDatasourceError(error) });
      },
    });
  },
});
