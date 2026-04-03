import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError, FeatureDisabledError, ViewNotAllowedError } from '../../errors/mcpToolError.js';
import { useRestApi } from '../../restApiInstance.js';
import { ProductVersion } from '../../sdks/tableau/types/serverInfo.js';
import { Server } from '../../server.js';
import { getResultForTableauVersion } from '../../utils/isTableauVersionAtLeast.js';
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

const MIN_VERSION_FOR_SVG = '2026.2.0';

export const getGetViewImageTool = (server: Server, tableauServerVersion: ProductVersion): Tool<typeof paramsSchema> => {
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
                format: formatToUse,
              });

              if (result.isErr()) {
                if (result.error.type === 'feature-disabled') {
                  return new FeatureDisabledError(
                    'The image format feature is disabled on this Tableau Server.',
                  ).toErr();
                }
                throw new Error(result.error.message);
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
