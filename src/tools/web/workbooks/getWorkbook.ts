import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { WorkbookNotAllowedError } from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { BoundedContext } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import {
  getWorkbookLineageByLuid,
  getWorkbookLineageQuery,
  mergeWorkbookLineage,
} from '../../../sdks/tableau/methods/lineageUtils.js';
import { View } from '../../../sdks/tableau/types/view.js';
import { Workbook } from '../../../sdks/tableau/types/workbook.js';
import { WebMcpServer } from '../../../server.web.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { getAppConfig } from '../../../web/apps/appConfig.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { AppToolResult, WebTool } from '../tool.js';
import { constructViewWebUrl } from '../utils/viewUrlUtils.js';

const paramsSchema = {
  workbookId: z.string(),
};

function getDefaultViewWebUrl(
  workbook: Workbook,
  flattenedViews: View[],
  server: string,
  siteName: string,
): string | undefined {
  if (!workbook.defaultViewId) {
    return undefined;
  }

  const defaultView = flattenedViews.find((view) => view.id === workbook.defaultViewId);
  if (!defaultView?.contentUrl) {
    return undefined;
  }

  return constructViewWebUrl(server, siteName, defaultView.contentUrl);
}

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
    app: getAppConfig('get-workbook'),
    callback: async ({ workbookId }, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();

      return await getWorkbookTool.logAndExecute<AppToolResult<Workbook>>({
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

          const workbook = await useRestApi({
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

              if (configWithOverrides.disableMetadataApiRequests) {
                return workbook;
              }

              try {
                const response = await restApi.metadataMethods.graphql(
                  getWorkbookLineageQuery([workbook.id]),
                );
                return mergeWorkbookLineage(
                  [workbook],
                  getWorkbookLineageByLuid(response),
                  configWithOverrides.boundedContext.datasourceIds,
                )[0];
              } catch (error) {
                log({
                  message: `Failed to enrich workbook ${workbook.id} with lineage metadata`,
                  level: 'warning',
                  logger: 'lineage',
                  data: getExceptionMessage(error),
                });
                return workbook;
              }
            },
          });

          const url =
            getDefaultViewWebUrl(
              workbook,
              workbook.views?.view ?? [],
              extra.config.server,
              extra.getSiteName(),
            ) ??
            workbook.webpageUrl ??
            '';

          return new Ok({
            data: workbook,
            url,
          });
        },
        constrainSuccessResult: (result) => {
          const { data: workbook, url } = result;

          const filteredWorkbook = filterWorkbookViews({
            workbook,
            boundedContext: configWithOverrides.boundedContext,
          });

          return {
            type: 'success',
            result: {
              data: filteredWorkbook,
              url,
            },
          };
        },
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
}): Workbook {
  const { viewIds, tags } = boundedContext;

  // We don't need to check the tags on the workbook since we already
  // did that before getting the detailed workbook information.
  // We only need to check the views on the workbook against viewIds and tags.
  if (!workbook.views || (!viewIds && !tags)) {
    return flattenWorkbookViewUsage(workbook);
  }

  let views = workbook.views.view;

  if (viewIds) {
    views = views.filter((view) => (view.id ? viewIds.has(view.id) : false));
  }

  if (tags) {
    views = views.filter((view) => view.tags?.tag?.some((tag) => tags.has(tag.label)));
  }

  workbook.views.view = views;

  return flattenWorkbookViewUsage(workbook);
}

function flattenWorkbookViewUsage(workbook: Workbook): Workbook {
  if (!workbook.views) {
    return workbook;
  }

  return {
    ...workbook,
    views: {
      view: workbook.views.view.map(({ usage, ...view }) => ({
        ...view,
        totalViewCount: usage?.totalViewCount ?? 0,
      })),
    },
  };
}
