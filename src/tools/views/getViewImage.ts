import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { getTableauAuthInfo } from '../../server/oauth/getTableauAuthInfo.js';
import { getSiteLuidFromAccessToken } from '../../utils/getSiteLuidFromAccessToken.js';
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
    description:
      'Retrieves an image of the specified view in a Tableau workbook. The width and height in pixels can be provided. The default width and height are both 800 pixels.',
    paramsSchema,
    annotations: {
      title: 'Get View Image',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (
      { viewId, width, height },
      { requestId, sessionId, authInfo, signal },
    ): Promise<CallToolResult> => {
      const config = getConfig();

      return await getViewImageTool.logAndExecute<string, GetViewImageError>({
        requestId,
        sessionId,
        authInfo,
        args: { viewId },
        callback: async () => {
          const isViewAllowedResult = await resourceAccessChecker.isViewAllowed({
            viewId,
            restApiArgs: { config, requestId, server, signal },
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
              signal,
              authInfo: getTableauAuthInfo(authInfo),
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
        productTelemetryBase: {
          endpoint: config.productTelemetryEndpoint,
          siteLuid: getSiteLuidFromAccessToken(getTableauAuthInfo(authInfo)?.accessToken),
          podName: config.server,
          isHyperforce: config.isHyperforce,
          enabled: config.productTelemetryEnabled,
        },
      });
    },
  });

  return getViewImageTool;
};
