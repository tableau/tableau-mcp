import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';

const paramsSchema = {
  viewId: z.string(),
};

export const getGetViewImageTool = (server: Server): Tool<typeof paramsSchema> => {
  const getViewImageTool = new Tool({
    server,
    name: 'get-view-image',
    description: `Retrieves an image of the specified view in a Tableau workbook.`,
    paramsSchema,
    annotations: {
      title: 'Get View Image',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ viewId }, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();

      return await getViewImageTool.logAndExecute({
        requestId,
        args: { viewId },
        callback: async () => {
          return new Ok(
            await useRestApi({
              config,
              requestId,
              server,
              jwtScopes: ['tableau:views:download'],
              callback: async (restApi) => {
                return await restApi.workbookMethods.queryViewImage({
                  viewId,
                  siteId: restApi.siteId,
                });
              },
            }),
          );
        },
        getSuccessResult: (pngData) => {
          const base64Data = Buffer.from(pngData).toString('base64');
          const size = Buffer.from(base64Data, 'base64').length;

          return {
            isError: false,
            content: [
              {
                type: 'image',
                data: base64Data,
                mimeType: 'image/png',
                annotations: {
                  size: size,
                },
              },
            ],
          };
        },
      });
    },
  });

  return getViewImageTool;
};
