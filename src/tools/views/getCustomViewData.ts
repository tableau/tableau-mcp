import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { Tool } from '../tool.js';

const paramsSchema = {
  customViewId: z.string(),
  maxAge: z
    .number()
    .positive()
    .int()
    .optional()
    .describe(
      'Optional max age in minutes for cached view data (Tableau REST `maxAge` query parameter). Minimum interval is 1 minute.',
    ),
  viewFilters: z
    .record(z.string())
    .optional()
    .describe(
      'Optional map of view filter field names to values. Keys are sent as `vf_<fieldname>` query parameters per Tableau REST API filter-query-views.',
    ),
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
      'Retrieves comma-separated value (CSV) data for a Tableau **custom view** (saved/personalized view state), including the user’s filters.',
      'Uses the Tableau REST API Get Custom View Data endpoint (API 3.23+). Requires the custom view LUID from the content URL (not the published view id).',
      'For published views without a custom view, use `get-view-data` with the view id instead.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title: 'Get Custom View Data',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ customViewId, maxAge, viewFilters }, extra): Promise<CallToolResult> => {
      return await getCustomViewDataTool.logAndExecute<string, GetCustomViewDataError>({
        extra,
        args: { customViewId, maxAge, viewFilters },
        callback: async () => {
          const isAllowedResult = await resourceAccessChecker.isCustomViewAllowed({
            customViewId,
            extra,
          });

          if (!isAllowedResult.allowed) {
            return new Err({
              type: 'custom-view-not-allowed',
              message: isAllowedResult.message,
            });
          }

          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: getCustomViewDataTool.requiredApiScopes,
              callback: async (restApi) => {
                return await restApi.viewsMethods.queryCustomViewData({
                  customViewId,
                  siteId: restApi.siteId,
                  maxAge,
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
        getErrorText: (error: GetCustomViewDataError) => {
          switch (error.type) {
            case 'custom-view-not-allowed':
              return error.message;
          }
        },
      });
    },
  });

  return getCustomViewDataTool;
};
