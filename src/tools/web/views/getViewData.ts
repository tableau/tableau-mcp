import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ViewNotAllowedError } from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { useRestApi } from '../../../restApiInstance.js';
import { parseViewAllData } from '../../../sdks/tableau/methods/viewAllData.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';
import {
  buildDataToolResult,
  DataToolResult,
  dataToolResultToCallToolResult,
} from './dataToolResult.js';

const paramsSchema = {
  viewId: z.string(),
  viewFilters: z
    .record(z.string())
    .optional()
    .describe('Optional map of view filter field names to values.'),
};

type ViewDataResult =
  | DataToolResult
  | Array<{
      sheetName: string;
      columns: string[];
      rows: string[][];
      sheetStatus: 'OK' | 'ERROR';
      errorDetail?: string;
    }>;

export const getGetViewDataTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const getViewDataTool = new WebTool({
    server,
    name: 'get-view-data',
    description: [
      "Retrieves data for the specified view in a Tableau workbook, including the user's filters.",
      "On Tableau REST API versions below 3.30, returns CSV data for the dashboard's first view.",
      'On version 3.30 or later, returns parsed data for the sheets included in the server response.',
      'Requires the view LUID from the content URL (not the published view id).',
      'For custom views, use the tool to get custom view data by custom view id instead.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title: 'Get View Data',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ viewId, viewFilters }, extra): Promise<CallToolResult> => {
      return await getViewDataTool.logAndExecute<ViewDataResult>({
        extra,
        args: { viewId, viewFilters },
        callback: async () => {
          const isViewAllowedResult = await resourceAccessChecker.isViewAllowed({
            viewId,
            extra,
          });

          if (!isViewAllowedResult.allowed) {
            return new ViewNotAllowedError(isViewAllowedResult.message).toErr();
          }

          if (RestApi.versionIsAtLeast('3.30')) {
            const response = await useRestApi({
              ...extra,
              jwtScopes: getViewDataTool.requiredApiScopes,
              callback: async (restApi) =>
                await restApi.viewsMethods.getViewAllData({
                  viewId,
                  siteId: restApi.siteId,
                  viewFilters,
                }),
            });
            const sheets = parseViewAllData(response.body, response.contentType);
            log(
              {
                message: 'Parsed view all-data response',
                level: 'debug',
                logger: 'tool',
                data: {
                  requestId: extra.requestId,
                  viewId,
                  sheetCount: sheets.length,
                  sheetNames: sheets.map((sheet) => sheet.sheetName),
                },
              },
              extra,
            );

            return new Ok(
              sheets.map((sheet) => ({
                sheetName: sheet.sheetName,
                columns: sheet.status === 'OK' ? sheet.columns : [],
                rows: sheet.status === 'OK' ? sheet.rows : [],
                sheetStatus: sheet.status === 'OK' ? 'OK' : 'ERROR',
                errorDetail: sheet.errorDetail,
              })),
            );
          }

          const csv = await useRestApi({
            ...extra,
            jwtScopes: getViewDataTool.requiredApiScopes,
            callback: async (restApi) => {
              return await restApi.viewsMethods.queryViewData({
                viewId,
                siteId: restApi.siteId,
                viewFilters,
              });
            },
          });

          // Offload to S3 (returning a presigned URL) when configured, otherwise
          // carry the raw CSV for an inline text result. Falls back to inline on
          // any S3 failure.
          return new Ok(
            await buildDataToolResult({
              csv,
              resourceId: viewId,
              config: extra.config,
              toolName: getViewDataTool.name,
              keyPrefixSegment: 'view-data/',
            }),
          );
        },
        constrainSuccessResult: (dataToolResult) => {
          return {
            type: 'success',
            result: dataToolResult,
          };
        },
        getSuccessResult: (dataToolResult) => {
          if ('kind' in dataToolResult) {
            return dataToolResultToCallToolResult(dataToolResult);
          }
          return {
            isError: false,
            content: [{ type: 'text', text: JSON.stringify(dataToolResult) }],
          };
        },
      });
    },
  });

  return getViewDataTool;
};
