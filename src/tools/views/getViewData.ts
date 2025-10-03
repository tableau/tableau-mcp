import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Dashboard, SheetType, Story, TableauViz } from '@tableau/embedding-api';
import fs from 'fs';
import path from 'path';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { Server } from '../../server.js';
import { getExceptionMessage } from '../../utils/getExceptionMessage.js';
import { getJwt, getJwtAdditionalPayload, getJwtSubClaim } from '../../utils/getJwt.js';
import { Tool } from '../tool.js';
import { Renderer, RendererError } from './renderer.js';

type GetViewDataError =
  | RendererError
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

      return await getViewDataTool.logAndExecute<Record<string, string>, GetViewDataError>({
        requestId,
        args: { url, sheetName },
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
          const result = await renderer.embedAndWaitForInteractive(server, embedUrl);

          if (result.isErr()) {
            return result;
          }

          const { page, browserSession, downloadPath } = result.value;

          await page.evaluate(
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

          await new Promise<void>((resolve, reject) => {
            browserSession.on('Browser.downloadProgress', (e) => {
              if (e.state === 'completed') {
                resolve();
              } else if (e.state === 'canceled') {
                reject('Download canceled');
              }
            });
          });

          await renderer.close();

          const files = fs.readdirSync(downloadPath);
          const fileContents = files.reduce<Record<string, string>>((acc, file) => {
            acc[file] = fs.readFileSync(path.join(downloadPath, file), 'utf8');
            return acc;
          }, {});

          fs.rmdirSync(downloadPath, { recursive: true });
          return Ok(fileContents);
        },
        getErrorText: (error: GetViewDataError) => {
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

  return getViewDataTool;
};
