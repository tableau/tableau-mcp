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

export const getQueryViewDataTool = (server: Server): Tool<typeof paramsSchema> => {
  const queryViewDataTool = new Tool({
    server,
    name: 'query-view-data',
    description: `Returns a specified view rendered as data in comma separated value (CSV) format.`,
    paramsSchema,
    annotations: {
      title: 'Query View Data',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ viewId }, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();

      return await queryViewDataTool.logAndExecute({
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

  return queryViewDataTool;
};
