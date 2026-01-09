import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { Server } from '../../server.js';
import { getTableauAuthInfo } from '../../server/oauth/getTableauAuthInfo.js';
import { getExceptionMessage } from '../../utils/getExceptionMessage.js';
import { getJwt, getJwtAdditionalPayload, getJwtUsername } from '../../utils/getJwt.js';
import { Tool } from '../tool.js';
import {
  BrowserController,
  BrowserControllerError,
  BrowserOptions,
  getBrowserControllerErrorMessage,
  isBrowserControllerErrorType,
} from './browserController.js';

type GetViewImageError =
  | BrowserControllerError
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
    description:
      'Retrieves an image of the specified view in a Tableau workbook. The width and height in pixels can be provided. The default width and height are both 800 pixels.',
    paramsSchema,
    annotations: {
      title: 'Get View Image',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ url, width, height }, { requestId, authInfo }): Promise<CallToolResult> => {
      const config = getConfig();

      return await getViewImageTool.logAndExecute<Uint8Array, GetViewImageError>({
        requestId,
        authInfo,
        args: { url },
        callback: async () => {
          // const isViewAllowedResult = await resourceAccessChecker.isViewAllowed({
          //   viewId,
          //   restApiArgs: { config, requestId, server },
          // });

          // if (!isViewAllowedResult.allowed) {
          //   return new Err({
          //     type: 'view-not-allowed',
          //     message: isViewAllowedResult.message,
          //   });
          // }

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

          const rendererOptions: BrowserOptions = {
            width: width || 800,
            height: height || 800,
          };

          const token =
            parsedUrl.host === 'public.tableau.com'
              ? ''
              : await getJwt({
                  username: getJwtUsername(config.jwtUsername, [
                    {
                      pattern: '{OAUTH_USERNAME}',
                      replacement: getTableauAuthInfo(authInfo)?.username ?? '',
                    },
                  ]),
                  config: {
                    type: 'connected-app',
                    clientId: config.connectedAppClientId,
                    secretId: config.connectedAppSecretId,
                    secretValue: config.connectedAppSecretValue,
                  },
                  scopes: new Set([
                    'tableau:views:embed',
                    'tableau:views:embed_authoring',
                    'tableau:insights:embed',
                  ]),
                  additionalPayload: getJwtAdditionalPayload(config.jwtAdditionalPayload, [
                    {
                      pattern: '{OAUTH_USERNAME}',
                      replacement: getTableauAuthInfo(authInfo)?.username ?? '',
                    },
                  ]),
                });

          // TODO: https
          const embedUrl = `http://localhost:${config.httpPort}/embed#?url=${url}&token=${token}`;

          const result = await BrowserController.create({ headless: !config.useHeadedBrowser })
            .then((b) => b.createNewPage(rendererOptions))
            .then((b) => b.enableDownloads())
            .then((b) => b.navigate(embedUrl))
            .then((b) => b.waitForPageLoad())
            .then((b) => b.takeScreenshot())
            .then((b) => b.getResult());

          if (result.isErr()) {
            return result;
          }

          const { screenshot } = result.value;
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
        constrainSuccessResult: (viewImage) => {
          return {
            type: 'success',
            result: viewImage,
          };
        },
        getErrorText: (error: GetViewImageError) => {
          return JSON.stringify({
            reason: getErrorMessage(error),
            exception: getExceptionMessage(error.error),
          });
        },
      });
    },
  });

  return getViewImageTool;
};

function getErrorMessage(error: GetViewImageError): string {
  if (isBrowserControllerErrorType(error.type)) {
    return getBrowserControllerErrorMessage(error.type);
  }

  switch (error.type) {
    case 'invalid-url':
      return `The URL is invalid: ${error.url}`;
    case 'embedding-api-not-found':
      return `The Embedding API JavaScript module was not found at ${error.url}.`;
  }
}
