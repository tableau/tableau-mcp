import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';

const paramsSchema = {};

export const getQueryWorkbooksTool = (server: Server): Tool<typeof paramsSchema> => {
  const queryWorkbooksTool = new Tool({
    server,
    name: 'query-workbooks',
    description: `Retrieves information about the workbooks that are available on a Tableau site.`,
    paramsSchema,
    annotations: {
      title: 'Query Workbooks',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (_, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();

      return await queryWorkbooksTool.logAndExecute({
        requestId,
        args: {},
        callback: async () => {
          return new Ok(
            await useRestApi(
              config.server,
              config.authConfig,
              requestId,
              server,
              async (restApi) => {
                return await restApi.workbookMethods.queryWorkbooksForSite(config.siteId);
              },
            ),
          );
        },
      });
    },
  });

  return queryWorkbooksTool;
};
