import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { convertPngDataToToolResult } from '../convertPngDataToToolResult.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { Tool } from '../tool.js';

const paramsSchema = {
  viewId: z.string(),
  width: z.number().gt(0).optional(),
  height: z.number().gt(0).optional(),
};

export type GetViewImageError = {
  type: 'view-not-allowed';
  message: string;
};

export const getGetViewImageTool = (server: Server): Tool<typeof paramsSchema> => {
  const getViewImageTool = new Tool({
    server,
    name: 'get-view-image',
    description: `Retrieves an image of the specified view in a Tableau workbook. The width and height in pixels can be provided. The default width and height are both 800 pixels.`,
    paramsSchema,
    annotations: {
      title: 'Get View Image',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ viewId, width, height }, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();

      return await getViewImageTool.logAndExecute<string, GetViewImageError>({
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
                return await restApi.viewsMethods.queryViewImage({
                  viewId,
                  siteId: restApi.siteId,
                  width,
                  height,
                  resolution: 'high',
                });
              },
            }),
          );
        },
        constrainSuccessResult: (viewImage) => {
          return {
            type: 'success',
            result: viewImage,
          };
        },
        getSuccessResult: convertPngDataToToolResult,
        getErrorText: (error: GetViewImageError) => {
          switch (error.type) {
            case 'view-not-allowed':
              return error.message;
          }
        },
      });
    },
  });

  return getViewImageTool;
};
