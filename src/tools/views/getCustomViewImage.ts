import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  ArgsValidationError,
  CustomViewNotAllowedError,
  FeatureDisabledError,
  UnknownError,
} from '../../errors/mcpToolError.js';
import { useRestApi } from '../../restApiInstance.js';
import { ProductVersion } from '../../sdks/tableau/types/serverInfo.js';
import { Server } from '../../server.js';
import { getResultForTableauVersion } from '../../utils/isTableauVersionAtLeast.js';
import { convertViewImageToToolResult } from '../convertViewImageToToolResult.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { Tool } from '../tool.js';
import { MIN_VERSION_FOR_SVG } from './constants.js';

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
      { customViewId, width, height, format, viewFilters },
      extra,
    ): Promise<CallToolResult> => {
      return await getCustomViewImageTool.logAndExecute<string>({
        extra,
        args: { customViewId, width, height, format, viewFilters },
        callback: async () => {
          // Version check for format parameter
          const supportsFormat = getResultForTableauVersion({
            productVersion: tableauServerVersion,
            mappings: {
              [MIN_VERSION_FOR_SVG]: true,
              default: false,
            },
          });

          // If SVG is requested but version is too old, return an error
          if (format === 'SVG' && !supportsFormat) {
            return new ArgsValidationError(
              `SVG format requires Tableau Server ${MIN_VERSION_FOR_SVG} or later. Current version: ${tableauServerVersion.value}`,
            ).toErr();
          }

          // If PNG is requested but version is too old, omit format parameter (PNG is default)
          const formatToUse = format === 'PNG' && !supportsFormat ? undefined : format;

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
                format: formatToUse,
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
