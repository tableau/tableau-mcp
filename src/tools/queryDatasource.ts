import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { config } from '../config.js';
import { getNewRestApiInstanceAsync } from '../restApiInstance.js';
import { Query } from '../sdks/tableau/apis/vizqlDataServiceApi.js';
import { getToolCallback, Tool } from './tool.js';

export const queryDatasourceTool = new Tool({
  name: 'query-datasource',
  description: 'Run a Tableau VizQL query.',
  paramsSchema: { query: Query },
  callback: async ({ query }): Promise<CallToolResult> => {
    return await getToolCallback(async (requestId) => {
      const datasource = { datasourceLuid: config.datasourceLuid };
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

      const restApi = await getNewRestApiInstanceAsync(config.server, config.authConfig, requestId);
      return await restApi.vizqlDataServiceMethods.queryDatasource(queryRequest);
    });
  },
});
