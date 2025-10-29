import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import { Workbook } from '../../sdks/tableau/types/workbook.js';
import { Server } from '../../server.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { Tool } from '../tool.js';

const paramsSchema = {
  workbookId: z.string(),
};

export type GetWorkbookError = {
  type: 'workbook-not-allowed';
  message: string;
};

export const getGetWorkbookTool = (server: Server): Tool<typeof paramsSchema> => {
  const getWorkbookTool = new Tool({
    server,
    name: 'get-workbook',
    description: `Retrieves information about the specified workbook, including information about the views contained in the workbook.`,
    paramsSchema,
    annotations: {
      title: 'Get Workbook',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ workbookId }, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();

      return await getWorkbookTool.logAndExecute<Workbook, GetWorkbookError>({
        requestId,
        args: { workbookId },
        callback: async () => {
          const isWorkbookAllowedResult = await resourceAccessChecker.isWorkbookAllowed({
            workbookId,
            restApiArgs: { config, requestId, server },
          });

          if (!isWorkbookAllowedResult.allowed) {
            return new Err({
              type: 'workbook-not-allowed',
              message: isWorkbookAllowedResult.message,
            });
          }

          return new Ok(
            await useRestApi({
              config,
              requestId,
              server,
              jwtScopes: ['tableau:content:read'],
              callback: async (restApi) => {
                // Notice that we already have the workbook if it had been allowed by a project scope.
                const workbook =
                  isWorkbookAllowedResult.content ??
                  (await restApi.workbooksMethods.getWorkbook({
                    workbookId,
                    siteId: restApi.siteId,
                  }));

                // The views returned by the getWorkbook API do not include usage statistics.
                // Query the views for the workbook to get each view's usage statistics.
                if (workbook.views) {
                  const views = await restApi.viewsMethods.queryViewsForWorkbook({
                    workbookId,
                    siteId: restApi.siteId,
                    includeUsageStatistics: true,
                  });

                  workbook.views.view = views;
                }

                return workbook;
              },
            }),
          );
        },
        constrainSuccessResult: (workbook) => {
          return {
            type: 'success',
            result: workbook,
          };
        },
        getErrorText: (error: GetWorkbookError) => {
          switch (error.type) {
            case 'workbook-not-allowed':
              return error.message;
          }
        },
      });
    },
  });

  return getWorkbookTool;
};
