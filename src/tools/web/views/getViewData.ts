import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ViewNotAllowedError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
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

export const getGetViewDataTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const getViewDataTool = new WebTool({
    server,
    name: 'get-view-data',
    description: [
      "Retrieves comma-separated value (CSV) data for the specified view in a Tableau workbook, including the user's filters.",
      "If the request is for a dashboard, only data for the dashboard's first view is returned.",
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
      return await getViewDataTool.logAndExecute<DataToolResult>({
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
        getSuccessResult: (dataToolResult) => dataToolResultToCallToolResult(dataToolResult),
      });
    },
  });

  return getViewDataTool;
};
