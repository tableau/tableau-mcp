import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  CustomViewNotAllowedError,
  FeatureDisabledError,
  UnknownError,
} from '../../errors/mcpToolError.js';
import { useRestApi } from '../../restApiInstance.js';
import { ProductVersion } from '../../sdks/tableau/types/serverInfo.js';
import { Server } from '../../server.js';
import { convertViewImageToToolResult } from '../convertViewImageToToolResult.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { Tool } from '../tool.js';
import { getImageFormatForVersion } from './getImageFormatForVersion.js';

const paramsSchema = {
  customViewId: z.string(),
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

export type GetCustomViewImageError = {
  type: 'custom-view-not-allowed';
  message: string;
};

export const getGetCustomViewImageTool = (
  server: Server,
  tableauServerVersion: ProductVersion,
): Tool<typeof paramsSchema> => {
  const getCustomViewImageTool = new Tool({
    server,
    name: 'get-custom-view-image',
    description: [
      'Retrieves an image of the specified custom view in a published viz.',
      'A custom view is a shortcut to a specific state of interaction, such as filter selections and sorting, for a published viz.',
      'Requires the custom view LUID from the content URL (not the published view id).',
      'Optional width and height in pixels control render size.',
      'Optional view field names and values can be provided to filter the custom view.',
      'For published views, use the tool to get view image by view id instead.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title: 'Get Custom View Image',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (
      { customViewId, width, height, format, viewFilters },
      extra,
    ): Promise<CallToolResult> => {
      return await getCustomViewImageTool.logAndExecute<string>({
        extra,
        args: { customViewId, width, height, format, viewFilters },
        callback: async () => {
          const formatResult = getImageFormatForVersion(format, tableauServerVersion);
          if (formatResult.isErr()) {
            return formatResult;
          }

          const isAllowedResult = await resourceAccessChecker.isCustomViewAllowed({
            customViewId,
            extra,
          });

          if (!isAllowedResult.allowed) {
            return new CustomViewNotAllowedError(isAllowedResult.message).toErr();
          }

          const result = await useRestApi({
            ...extra,
            jwtScopes: getCustomViewImageTool.requiredApiScopes,
            callback: async (restApi) => {
              return await restApi.viewsMethods.getCustomViewImage({
                customViewId,
                siteId: restApi.siteId,
                width,
                height,
                resolution: 'high',
                format: formatResult.value,
                viewFilters,
              });
            },
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
        constrainSuccessResult: (imageData) => {
          return {
            type: 'success',
            result: imageData,
          };
        },
        getSuccessResult: (imageData) => convertViewImageToToolResult(imageData, format),
      });
    },
  });

  return getCustomViewImageTool;
};
