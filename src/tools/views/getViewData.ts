import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Dashboard, SheetType, Story, TableauViz } from '@tableau/embedding-api';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { Server } from '../../server.js';
import { getExceptionMessage } from '../../utils/getExceptionMessage.js';
import { getJwt, getJwtAdditionalPayload, getJwtSubClaim } from '../../utils/getJwt.js';
import { Tool } from '../tool.js';
import {
  BrowserController,
  BrowserControllerError,
  getBrowserControllerErrorMessage,
  isBrowserControllerErrorType,
} from './browserController.js';

type GetViewDataError =
  | BrowserControllerError
  | { type: 'invalid-url' | 'embedding-api-not-found'; url: string; error: unknown };

const paramsSchema = {
  url: z.string(),
  sheetName: z.string().optional(),
};

export const getGetViewDataTool = (server: Server): Tool<typeof paramsSchema> => {
  const getViewDataTool = new Tool({
    server,
    name: 'get-view-data',
    description: `Retrieves data in comma separated value (CSV) format for the specified view in a Tableau workbook.`,
    paramsSchema,
    annotations: {
      title: 'Get View Data',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ url, sheetName }, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();

      return await getViewDataTool.logAndExecute<
        Array<{ filename: string; content: string }>,
        GetViewDataError
      >({
        requestId,
        args: { url, sheetName },
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

          const result = await BrowserController.create({ headless: !config.useHeadedBrowser })
            .then((b) => b.createNewPage({ width: 800, height: 600 }))
            .then((b) => b.enableDownloads())
            .then((b) => b.navigate(embedUrl))
            .then((b) => b.waitForPageLoad())
            .then((b) => b.takeScreenshot())
            .then((b) => b.getResult());

          if (result.isErr()) {
            return result;
          }

          const browserController = result.value;
          await browserController.page.evaluate(
            async ({ sheetName, SheetType }) => {
              const viz = document.getElementById('viz') as TableauViz;
              const activeSheet = viz.workbook.activeSheet;
              if (activeSheet.sheetType === SheetType.Worksheet) {
                await viz.exportDataAsync(activeSheet.name);
              } else if (activeSheet.sheetType === SheetType.Dashboard) {
                if (sheetName) {
                  await viz.exportDataAsync(sheetName);
                } else {
                  for (const worksheet of (activeSheet as Dashboard).worksheets) {
                    await viz.exportDataAsync(worksheet.name);
                  }
                }
              } else {
                const containedSheet = (activeSheet as Story).activeStoryPoint.containedSheet;
                if (containedSheet && containedSheet.sheetType === SheetType.Worksheet) {
                  await viz.exportDataAsync(containedSheet.name);
                } else if (containedSheet && containedSheet.sheetType === SheetType.Dashboard) {
                  if (sheetName) {
                    await viz.exportDataAsync(sheetName);
                  } else {
                    for (const worksheet of (containedSheet as Dashboard).worksheets) {
                      await viz.exportDataAsync(worksheet.name);
                    }
                  }
                }
              }
            },
            { sheetName, SheetType },
          );

          await browserController.waitForDownloads();
          const fileContents = await browserController.getAndDeleteDownloads();
          return Ok(fileContents);
        },
        constrainSuccessResult: (viewData) => {
          return {
            type: 'success',
            result: viewData,
          };
        },
        getErrorText: (error: GetViewDataError) => {
          return JSON.stringify({
            reason: getErrorMessage(error),
            exception: getExceptionMessage(error.error),
          });
        },
      });
    },
  });

  return getViewDataTool;
};

function getErrorMessage(error: GetViewDataError): string {
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
