import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Datasource, Query, TableauError } from '../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';
import { getDatasourceCredentials } from './datasourceCredentials.js';
import { handleQueryDatasourceError } from './queryDatasourceErrorHandler.js';
import { validateQuery } from './queryDatasourceValidator.js';
import { queryDatasourceToolDescription } from './queryDescription.js';

type Datasource = z.infer<typeof Datasource>;

const paramsSchema = {
  datasourceLuid: z.string().nonempty(),
  query: Query,
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

          const queryRequest = {
            datasource,
            query,
            options,
          };

          const restApi = await getNewRestApiInstanceAsync(
            config.server,
            config.authConfig,
            requestId,
            server,
          );

          return await restApi.vizqlDataServiceMethods.queryDatasource(queryRequest);
        },
        getErrorText: (error: z.infer<typeof TableauError>) => {
          return JSON.stringify({ requestId, ...handleQueryDatasourceError(error) });
        },
      });
    },
  });

  return queryDatasourceTool;
};
