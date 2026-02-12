import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { BoundedContext, getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import { Workbook } from '../../sdks/tableau/types/workbook.js';
import { Server } from '../../server.js';
import { getTableauAuthInfo } from '../../server/oauth/getTableauAuthInfo.js';
import { getRequiredApiScopesForTool } from '../../server/oauth/scopes.js';
import { createProductTelemetryBase } from '../../telemetry/productTelemetry/telemetryForwarder.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { ConstrainedResult, Tool } from '../tool.js';

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
    description:
      'Retrieves information about the specified workbook, including information about the views contained in the workbook.',
    paramsSchema,
    annotations: {
      title: 'Get Workbook',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (
      { workbookId },
      { requestId, sessionId, authInfo, signal },
    ): Promise<CallToolResult> => {
      const config = getConfig();

      return await getWorkbookTool.logAndExecute<Workbook, GetWorkbookError>({
        requestId,
        sessionId,
        authInfo,
        args: { workbookId },
        callback: async () => {
          const isWorkbookAllowedResult = await resourceAccessChecker.isWorkbookAllowed({
            workbookId,
            restApiArgs: { config, requestId, server, signal },
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
              jwtScopes: getRequiredApiScopesForTool('get-workbook'),
              signal,
              authInfo: getTableauAuthInfo(authInfo),
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
        constrainSuccessResult: (workbook) =>
          filterWorkbookViews({ workbook, boundedContext: config.boundedContext }),
        getErrorText: (error: GetWorkbookError) => {
          switch (error.type) {
            case 'workbook-not-allowed':
              return error.message;
          }
        },
        productTelemetryBase: createProductTelemetryBase(config, authInfo),
      });
    },
  });

  return getWorkbookTool;
};

export function filterWorkbookViews({
  workbook,
  boundedContext,
}: {
  workbook: Workbook;
  boundedContext: BoundedContext;
}): ConstrainedResult<Workbook> {
  const { tags } = boundedContext;

  // We don't need to check the tags on the workbook since we already
  // did that before getting the detailed workbook information.
  // We only need to check the tags on the workbook's views.
  if (!workbook.views || !tags) {
    return {
      type: 'success',
      result: workbook,
    };
  }

  workbook.views.view = workbook.views.view.filter((view) =>
    view.tags?.tag?.some((tag) => tags.has(tag.label)),
  );

  return {
    type: 'success',
    result: workbook,
  };
}
