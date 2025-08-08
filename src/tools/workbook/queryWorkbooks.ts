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
    description: `Retrieves information about the workbooks and views that are available on a Tableau site.`,
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
            await useRestApi({
              config,
              requestId,
              server,
              jwtScopes: ['tableau:content:read'],
              callback: async (restApi) => {
                return await restApi.workbookMethods.queryWorkbooksForSite(restApi.siteId);
              },
            }),
          );
        },
      });
    },
  });

  return queryWorkbooksTool;
};
