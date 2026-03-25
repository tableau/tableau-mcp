import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { ViewNotAllowedError } from '../../errors/mcpToolError.js';
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

export const getGetViewImageTool = (server: Server): Tool<typeof paramsSchema> => {
  const getViewImageTool = new Tool({
    server,
    name: 'get-view-image',
    description:
      'Retrieves an image of the specified view in a Tableau workbook. The width and height in pixels can be provided. The default width and height are both 800 pixels.',
    paramsSchema,
    annotations: {
      title: 'Get View Image',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ viewId, width, height }, extra): Promise<CallToolResult> => {
      return await getViewImageTool.logAndExecute<string>({
        extra,
        args: { viewId },
        callback: async () => {
          const isViewAllowedResult = await resourceAccessChecker.isViewAllowed({
            viewId,
            extra,
          });

          if (!isViewAllowedResult.allowed) {
            return new Err(new ViewNotAllowedError(isViewAllowedResult.message));
          }

          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: getViewImageTool.requiredApiScopes,
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
      });
    },
  });

  return getViewImageTool;
};
