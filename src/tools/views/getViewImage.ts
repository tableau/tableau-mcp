import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ViewNotAllowedError } from '../../errors/mcpToolError.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { convertViewImageToToolResult } from '../convertViewImageToToolResult.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { Tool } from '../tool.js';

const paramsSchema = {
  viewId: z.string(),
  width: z.number().gt(0).optional(),
  height: z.number().gt(0).optional(),
  format: z
    .enum(['PNG', 'SVG'])
    .optional()
    .describe(
      'The image format to return. Use "PNG" (default) when the image will be analyzed or interpreted. Use "SVG" when the image will be displayed to the user — SVG is scalable and produces smaller file sizes.',
    ),
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
    callback: async ({ viewId, width, height, format }, extra): Promise<CallToolResult> => {
      return await getViewImageTool.logAndExecute<string>({
        extra,
        args: { viewId },
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
              jwtScopes: getViewImageTool.requiredApiScopes,
              callback: async (restApi) => {
                return await restApi.viewsMethods.queryViewImage({
                  viewId,
                  siteId: restApi.siteId,
                  width,
                  height,
                  resolution: 'high',
                  format,
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
        getSuccessResult: (imageData) => convertViewImageToToolResult(imageData, format),
      });
    },
  });

  return getViewImageTool;
};
