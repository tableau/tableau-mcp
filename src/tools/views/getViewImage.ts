import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { Server } from '../../server.js';
import { getExceptionMessage } from '../../utils/getExceptionMessage.js';
import { getEmbeddingJwt, getWorkgroupSessionId } from '../../utils/getTableauAccessTokens.js';
import { parseUrl } from '../../utils/parseUrl.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { Tool } from '../tool.js';
import {
  BrowserController,
  BrowserControllerError,
  BrowserOptions,
  getBrowserControllerErrorMessage,
  isBrowserControllerError,
} from './browserController.js';

type GetViewImageError =
  | BrowserControllerError
  | {
      type: 'embedding-api-not-found';
      url: string;
      error: unknown;
    }
  | {
      type: 'invalid-url';
      url: string;
    }
  | {
      type: 'view-not-allowed';
      message: string;
    };

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
    callback: async (
      { url, width, height },
      { requestId, authInfo, signal },
    ): Promise<CallToolResult> => {
      const config = getConfig();

      return await getViewImageTool.logAndExecute<Uint8Array, GetViewImageError>({
        requestId,
        authInfo,
        args: { url },
        callback: async ({ cleanupActions }) => {
          const parsedUrl = parseUrl(url);
          if (!parsedUrl) {
            return Err({
              type: 'invalid-url',
              url,
            });
          }

          const isViewAllowedResult = await resourceAccessChecker.isViewAllowedByUrl({
            url: parsedUrl,
            restApiArgs: { config, requestId, server, signal },
          });

          if (!isViewAllowedResult.allowed) {
            return new Err({
              type: 'view-not-allowed',
              message: isViewAllowedResult.message,
            });
          }

          const rendererOptions: BrowserOptions = {
            width: width || 800,
            height: height || 800,
          };

          const token =
            config.auth === 'pat' ||
            config.auth === 'oauth' ||
            parsedUrl.host === 'public.tableau.com'
              ? ''
              : await getEmbeddingJwt({ config, authInfo });

          const protocol = config.sslCert ? 'https' : 'http';
          const embedUrl = `${protocol}://localhost:${config.httpPort}/embed#?url=${url}&token=${token}`;

          const result = await BrowserController.use(
            { headless: !config.useHeadedBrowser },
            (browserController) => {
              return browserController
                .createNewPage(rendererOptions)
                .then((b) => b.enableDownloads())
                .then((b) => b.navigate(embedUrl))
                .then(async (b) => {
                  if (parsedUrl.host === 'public.tableau.com') {
                    // No auth for Public
                    return b;
                  }

                  if (config.auth === 'direct-trust' || config.auth === 'uat') {
                    // For Direct Trust and UAT, the JWT will be provided to the /embed endpoint.
                    // The Embedding API will use the JWT to authenticate.
                    return b;
                  }

                  // For PAT and OAuth, we need to set the workgroup_session_id cookie ourselves.
                  const { workgroupSessionId, domain } = await getWorkgroupSessionId(
                    config.auth,
                    config,
                    authInfo,
                    { config, requestId, server, signal },
                    cleanupActions,
                  );

                  return await b.setWorkgroupSessionId({ workgroupSessionId, domain });
                })
                .then((b) => b.waitForPageLoad())
                .then((b) => b.takeScreenshot())
                .then((b) => b.getResult());
            },
          );

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
            exception: isBrowserControllerError(error)
              ? getExceptionMessage(error.error)
              : undefined,
          });
        },
      });
    },
  });

  return getViewImageTool;
};

function getErrorMessage(error: GetViewImageError): string {
  if (isBrowserControllerError(error)) {
    return getBrowserControllerErrorMessage(error.type, error.error);
  }

  switch (error.type) {
    case 'invalid-url':
      return `The URL is invalid: ${error.url}`;
    case 'embedding-api-not-found':
      return `The Embedding API JavaScript module was not found at ${error.url}.`;
    case 'view-not-allowed':
      return error.message;
  }
}
