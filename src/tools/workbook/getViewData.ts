import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';

const paramsSchema = {
  viewId: z.string(),
};

export const getGetViewDataTool = (server: Server): Tool<typeof paramsSchema> => {
  const getViewDataTool = new Tool({
    server,
    name: 'get-view-data',
    description: `Retrieves data in comma separated value (CSV) format for the specified view in a Tableau workbook.`,
    paramsSchema,
    annotations: {
      title: 'Get View Data',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ viewId }, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();

      return await getViewDataTool.logAndExecute({
        requestId,
        args: { viewId },
        callback: async () => {
          return new Ok(
            await useRestApi({
              config,
              requestId,
              server,
              jwtScopes: ['tableau:views:download'],
              callback: async (restApi) => {
                return await restApi.workbookMethods.queryViewData({
                  viewId,
                  siteId: restApi.siteId,
                });
              },
            }),
          );
        },
      });
    },
  });

  return getViewDataTool;
};
