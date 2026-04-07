import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  FeatureDisabledError,
  UnknownError,
  ViewNotAllowedError,
} from '../../errors/mcpToolError.js';
import { useRestApi } from '../../restApiInstance.js';
import { ProductVersion } from '../../sdks/tableau/types/serverInfo.js';
import { Server } from '../../server.js';
import { convertViewImageToToolResult } from '../convertViewImageToToolResult.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { Tool } from '../tool.js';
import { getImageFormatForVersion } from './getImageFormatForVersion.js';

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
  viewFilters: z
    .record(z.string())
    .optional()
    .describe('Optional map of view filter field names to values.'),
};

export const getGetViewImageTool = (
  server: Server,
  tableauServerVersion: ProductVersion,
): Tool<typeof paramsSchema> => {
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
    callback: async (
      { viewId, width, height, format, viewFilters },
      extra,
    ): Promise<CallToolResult> => {
      return await getViewImageTool.logAndExecute<string>({
        extra,
        args: { viewId, width, height, format, viewFilters },
        callback: async () => {
          const formatResult = getImageFormatForVersion(format, tableauServerVersion);
          if (formatResult.isErr()) {
            return formatResult;
          }

          const isViewAllowedResult = await resourceAccessChecker.isViewAllowed({
            viewId,
            extra,
          });

          if (!isViewAllowedResult.allowed) {
            return new ViewNotAllowedError(isViewAllowedResult.message).toErr();
          }

          return await useRestApi({
            ...extra,
            jwtScopes: getViewImageTool.requiredApiScopes,
            callback: async (restApi) => {
              const result = await restApi.viewsMethods.queryViewImage({
                viewId,
                siteId: restApi.siteId,
                width,
                height,
                resolution: 'high',
                format: formatResult.value,
                viewFilters,
              });

              if (result.isErr()) {
                if (result.error.type === 'feature-disabled') {
                  return new FeatureDisabledError(
                    'The image format feature is disabled on this Tableau Server.',
                  ).toErr();
                }
                return new UnknownError(result.error.message, 400).toErr();
              }

              return new Ok(result.value);
            },
          });
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
