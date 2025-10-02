import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { Server } from '../../server.js';
import { getJwt, getJwtAdditionalPayload, getJwtSubClaim } from '../../utils/getJwt.js';
import { Tool } from '../tool.js';
import { createRenderer, RendererOptions } from './renderer.js';

const paramsSchema = {
  url: z.string(),
  width: z.number().gt(0).optional(),
  height: z.number().gt(0).optional(),
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
    callback: async ({ url, width, height }, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();

      return await getViewImageTool.logAndExecute({
        requestId,
        args: { url },
        callback: async () => {
          // TODO: Validate URL is a valid Tableau view URL

          const rendererOptions: RendererOptions = {
            width: width || 800,
            height: height || 800,
            url,
          };

          const token = await getJwt({
            username: getJwtSubClaim(config),
            connectedApp: {
              clientId: config.connectedAppClientId,
              secretId: config.connectedAppSecretId,
              secretValue: config.connectedAppSecretValue,
            },
            scopes: new Set([
              'tableau:views:embed',
              'tableau:views:embed_authoring',
              'tableau:insights:embed',
            ]),
            additionalPayload: getJwtAdditionalPayload(config),
          });

          // TODO: https
          const embedUrl = `http://localhost:${config.httpPort}/embed#?url=${url}&token=${token}`;

          const renderer = await createRenderer();
          const screenshot = await renderer.screenshot(server, embedUrl, rendererOptions);
          await renderer.close();
          return screenshot;
        },
        getSuccessResult: (screenshot: Uint8Array) => {
          const base64Data = Buffer.from(screenshot).toString('base64');
          return {
            isError: false,
            content: [
              {
                type: 'image',
                data: base64Data,
                mimeType: 'image/png',
              },
            ],
          };
        },
        getErrorText: (error) => {
          return error;
        },
      });
    },
  });

  return getViewImageTool;
};
