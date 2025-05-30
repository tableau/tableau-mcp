import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Datasource, TableauError } from '../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { Tool } from '../tool.js';
import { getDatasourceCredentials } from './datasourceCredentials.js';
import { handleQueryDatasourceError } from './queryDatasourceErrorHandler.js';
import { queryDatasourceToolDescription } from './queryDescription.js';
import { DatasourceQuery } from './querySchemas.js';

type Datasource = z.infer<typeof Datasource>;

export const queryDatasourceTool = new Tool({
  name: 'query-datasource',
  description: queryDatasourceToolDescription,
  paramsSchema: {
    datasourceLuid: z.string(),
    datasourceQuery: DatasourceQuery,
  },
  annotations: {
    title: 'Query Datasource',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ datasourceLuid, datasourceQuery }): Promise<CallToolResult> => {
    const config = getConfig();
    return await queryDatasourceTool.logAndExecute({
      args: { datasourceLuid, datasourceQuery },
      callback: async (requestId) => {
        const datasource: Datasource = { datasourceLuid };
        const options = {
          returnFormat: 'OBJECTS',
          debug: false,
          disaggregate: false,
        } as const;

        const credentials = getDatasourceCredentials(datasourceLuid);
        if (credentials) {
          datasource.connections = [
            {
              connectionUsername: credentials.username,
              connectionPassword: credentials.password,
            },
          ];
        }

        const queryRequest = {
          datasource,
          query: datasourceQuery,
          options,
        };

        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );

        return await restApi.vizqlDataServiceMethods.queryDatasource(queryRequest);
      },
      getErrorText: (error: z.infer<typeof TableauError>) => {
        return JSON.stringify(handleQueryDatasourceError(error));
      },
    });
  },
});
