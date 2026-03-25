import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { convertPngDataToToolResult } from '../convertPngDataToToolResult.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { Tool } from '../tool.js';

const paramsSchema = {
  customViewId: z.string(),
  width: z.number().gt(0).optional(),
  height: z.number().gt(0).optional(),
  maxAge: z
    .number()
    .positive()
    .int()
    .optional()
    .describe('Optional max age in minutes for cached image. Minimum interval is 1 minute.'),
  viewFilters: z
    .record(z.string())
    .optional()
    .describe('Optional map of view filter field names to values.'),
};

export type GetCustomViewImageError = {
  type: 'custom-view-not-allowed';
  message: string;
};

export const getGetCustomViewImageTool = (server: Server): Tool<typeof paramsSchema> => {
  const getCustomViewImageTool = new Tool({
    server,
    name: 'get-custom-view-image',
    description: [
      "Retrieves a PNG image of a Tableau Custom View (saved/personalized view state), including the user's filters.",
      'Requires the custom view LUID from the content URL (not the published view id).',
      'Optional width and height in pixels control render size (`width` / `height`); defaults follow Tableau when omitted. For published views only, use the tool to get view image by view id instead.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title: 'Get Custom View Image',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (
      { customViewId, width, height, maxAge, viewFilters },
      extra,
    ): Promise<CallToolResult> => {
      return await getCustomViewImageTool.logAndExecute<string, GetCustomViewImageError>({
        extra,
        args: { customViewId, width, height, maxAge, viewFilters },
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
              jwtScopes: getCustomViewImageTool.requiredApiScopes,
              callback: async (restApi) => {
                return await restApi.viewsMethods.getCustomViewImage({
                  customViewId,
                  siteId: restApi.siteId,
                  width,
                  height,
                  resolution: 'high',
                  maxAge,
                  viewFilters,
                });
              },
            }),
          );
        },
        constrainSuccessResult: (imageData) => {
          return {
            type: 'success',
            result: imageData,
          };
        },
        getSuccessResult: convertPngDataToToolResult,
        getErrorText: (error: GetCustomViewImageError) => {
          switch (error.type) {
            case 'custom-view-not-allowed':
              return error.message;
          }
        },
      });
    },
  });

  return getCustomViewImageTool;
};
