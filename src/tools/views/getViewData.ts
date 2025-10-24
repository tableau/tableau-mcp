import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { Tool } from '../tool.js';

const paramsSchema = {
  viewId: z.string(),
};

export type GetViewDataError = {
  type: 'view-not-allowed';
  message: string;
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

      return await getViewDataTool.logAndExecute<string, GetViewDataError>({
        requestId,
        args: { viewId },
        callback: async () => {
          const isViewAllowedResult = await resourceAccessChecker.isViewAllowed({
            viewId,
            restApiArgs: { config, requestId, server },
          });

          if (!isViewAllowedResult.allowed) {
            return new Err({
              type: 'view-not-allowed',
              message: isViewAllowedResult.message,
            });
          }

          return new Ok(
            await useRestApi({
              config,
              requestId,
              server,
              jwtScopes: ['tableau:views:download'],
              callback: async (restApi) => {
                return await restApi.viewsMethods.queryViewData({
                  viewId,
                  siteId: restApi.siteId,
                });
              },
            }),
          );
        },
        constrainSuccessResult: (viewData) => {
          return {
            type: 'success',
            result: viewData,
          };
        },
        getErrorText: (error: GetViewDataError) => {
          switch (error.type) {
            case 'view-not-allowed':
              return error.message;
          }
        },
      });
    },
  });

  return getViewDataTool;
};
