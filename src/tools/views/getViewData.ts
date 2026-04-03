import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ViewNotAllowedError } from '../../errors/mcpToolError.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { Tool } from '../tool.js';

const paramsSchema = {
  viewId: z.string(),
  viewFilters: z
    .record(z.string())
    .optional()
    .describe('Optional map of view filter field names to values.'),
};

export const getGetViewDataTool = (server: Server): Tool<typeof paramsSchema> => {
  const getViewDataTool = new Tool({
    server,
    name: 'get-view-data',
    description:
      'Retrieves data in comma separated value (CSV) format for the specified view in a Tableau workbook.',
    paramsSchema,
    annotations: {
      title: 'Get View Data',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ viewId, viewFilters }, extra): Promise<CallToolResult> => {
      return await getViewDataTool.logAndExecute<string>({
        extra,
        args: { viewId, viewFilters },
        callback: async () => {
          const isViewAllowedResult = await resourceAccessChecker.isViewAllowed({
            viewId,
            extra,
          });

          if (!isViewAllowedResult.allowed) {
            return new ViewNotAllowedError(isViewAllowedResult.message).toErr();
          }

          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: getViewDataTool.requiredApiScopes,
              callback: async (restApi) => {
                return await restApi.viewsMethods.queryViewData({
                  viewId,
                  siteId: restApi.siteId,
                  viewFilters,
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
      });
    },
  });

  return getViewDataTool;
};
