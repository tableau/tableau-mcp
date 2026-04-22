import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { WorkbookNotAllowedError } from '../../../errors/mcpToolError.js';
import { BoundedContext } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import { Workbook } from '../../../sdks/tableau/types/workbook.js';
import { WebMcpServer } from '../../../server.web.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { ConstrainedResult, WebTool } from '../tool.js';

const paramsSchema = {
  workbookId: z.string(),
};

export const getGetWorkbookTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const getWorkbookTool = new WebTool({
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
    callback: async ({ workbookId }, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();

      return await getWorkbookTool.logAndExecute<Workbook>({
        extra,
        args: { workbookId },
        callback: async () => {
          const isWorkbookAllowedResult = await resourceAccessChecker.isWorkbookAllowed({
            workbookId,
            extra,
          });

          if (!isWorkbookAllowedResult.allowed) {
            return new WorkbookNotAllowedError(isWorkbookAllowedResult.message).toErr();
          }

          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: getWorkbookTool.requiredApiScopes,
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
          filterWorkbookViews({ workbook, boundedContext: configWithOverrides.boundedContext }),
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
