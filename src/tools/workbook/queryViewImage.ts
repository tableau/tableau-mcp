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

export const getQueryViewImageTool = (server: Server): Tool<typeof paramsSchema> => {
  const queryViewImageTool = new Tool({
    server,
    name: 'query-view-image',
    description: `Retrieves an image of the specified view.`,
    paramsSchema,
    annotations: {
      title: 'Query View Image',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ viewId }, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();

      return await queryViewImageTool.logAndExecute({
        requestId,
        args: { viewId },
        callback: async () => {
          return new Ok(
            await useRestApi(
              config.server,
              config.authConfig,
              requestId,
              server,
              async (restApi) => {
                return await restApi.workbookMethods.queryViewImage(viewId);
              },
            ),
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

  return queryViewImageTool;
};
