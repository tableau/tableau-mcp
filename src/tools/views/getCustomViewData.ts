import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { CustomViewNotAllowedError } from '../../errors/mcpToolError.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { Tool } from '../tool.js';

const paramsSchema = {
  customViewId: z.string(),
  viewFilters: z
    .record(z.string())
    .optional()
    .describe('Optional map of view filter field names to values.'),
};

export type GetCustomViewDataError = {
  type: 'custom-view-not-allowed';
  message: string;
};

export const getGetCustomViewDataTool = (server: Server): Tool<typeof paramsSchema> => {
  const getCustomViewDataTool = new Tool({
    server,
    name: 'get-custom-view-data',
    description: [
      "Retrieves comma-separated value (CSV) data for a Tableau Custom View (saved/personalized view state), including the user's filters.",
      'Requires the custom view LUID from the content URL (not the published view id).',
      'For published views, use the tool to get view data by view id instead.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title: 'Get Custom View Data',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ customViewId, viewFilters }, extra): Promise<CallToolResult> => {
      return await getCustomViewDataTool.logAndExecute({
        extra,
        args: { customViewId, viewFilters },
        callback: async () => {
          const isAllowedResult = await resourceAccessChecker.isCustomViewAllowed({
            customViewId,
            extra,
          });

          if (!isAllowedResult.allowed) {
            return new CustomViewNotAllowedError(isAllowedResult.message).toErr();
          }

          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: getCustomViewDataTool.requiredApiScopes,
              callback: async (restApi) => {
                return await restApi.viewsMethods.getCustomViewData({
                  customViewId,
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

  return getCustomViewDataTool;
};
