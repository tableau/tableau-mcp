import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Query } from '../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { Tool } from '../tool.js';
import { queryDatasourceToolDescription } from './queryDescription.js';

export const queryDatasourceTool = new Tool({
  name: 'query-datasource',
  description: queryDatasourceToolDescription,
  paramsSchema: {
    datasourceLuid: z.string(),
    query: Query,
  },
  callback: async ({ datasourceLuid, query }): Promise<CallToolResult> => {
    const config = getConfig();
    return await queryDatasourceTool.logAndExecute({
      args: { datasourceLuid, query },
      callback: async (requestId) => {
        const datasource = { datasourceLuid };
        const options = {
          returnFormat: 'OBJECTS',
          debug: false,
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
    });
  },
});
