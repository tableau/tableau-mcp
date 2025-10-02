import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { Server } from '../../server.js';
import { getExceptionMessage } from '../../utils/getExceptionMessage.js';
import { getJwt, getJwtAdditionalPayload, getJwtSubClaim } from '../../utils/getJwt.js';
import { Tool } from '../tool.js';
import { Renderer, RendererError, RendererOptions } from './renderer.js';

type GetViewImageError =
  | RendererError
  | { type: 'invalid-url' | 'embedding-api-not-found'; url: string; error: unknown };

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

      return await getViewImageTool.logAndExecute<Uint8Array, GetViewImageError>({
        requestId,
        args: { url },
        callback: async () => {
          let parsedUrl: URL;
          try {
            parsedUrl = new URL(url);
          } catch (error) {
            return Err({
              type: 'invalid-url',
              url,
              error,
            });
          }

          const embeddingApiUrl = `${parsedUrl.origin}/javascripts/api/tableau.embedding.3.latest.js`;
          try {
            const response = await fetch(embeddingApiUrl);
            if (!response.ok) {
              return Err({
                type: 'embedding-api-not-found',
                url: embeddingApiUrl,
                error: new Error(
                  `Failed to fetch embedding API JavaScript module: ${response.status} ${response.statusText}`,
                ),
              });
            }
          } catch (error) {
            return Err({
              type: 'embedding-api-not-found',
              url: embeddingApiUrl,
              error,
            });
          }

          const rendererOptions: RendererOptions = {
            width: width || 800,
            height: height || 800,
            url,
          };

          const token =
            parsedUrl.host === 'public.tableau.com'
              ? ''
              : await getJwt({
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

          const renderer = await Renderer.create({ headless: !config.useHeadedBrowser });
          const result = await renderer.screenshot(server, embedUrl, rendererOptions);
          if (result.isErr()) {
            return result;
          }

          const screenshot = result.value;
          await renderer.close();
          return Ok(screenshot);
        },
        getSuccessResult: (screenshot: Uint8Array): CallToolResult => {
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
        getErrorText: (error: GetViewImageError) => {
          return JSON.stringify({
            reason: (() => {
              switch (error.type) {
                case 'invalid-url':
                  return `The URL is invalid: ${error.url}`;
                case 'embedding-api-not-found':
                  return `The Embedding API JavaScript module was not found at ${error.url}.`;
                case 'screenshot-failed':
                  return 'Failed to take screenshot of the view.';
                case 'navigation-failed':
                  return 'Failed to navigate to the view.';
                case 'page-failed-to-load':
                  return 'Failed to load the view.';
                case 'browser-context-creation-failed':
                  return 'Failed to create browser context.';
                case 'page-creation-failed':
                  return 'Failed to create page.';
              }
            })(),
            exception: getExceptionMessage(error.error),
          });
        },
      });
    },
  });

  return getViewImageTool;
};
