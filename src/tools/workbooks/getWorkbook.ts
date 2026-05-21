import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { WorkbookNotAllowedError } from '../../errors/mcpToolError.js';
import { BoundedContext } from '../../overridableConfig.js';
import { useRestApi } from '../../restApiInstance.js';
import { Workbook } from '../../sdks/tableau/types/workbook.js';
import { Server } from '../../server.js';
import { getJwt } from '../../utils/getJwt.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { ConstrainedResult, Tool } from '../tool.js';

const paramsSchema = {
  workbookId: z.string(),
};

type GetWorkbookResult = {
  workbook: Workbook;
  url?: string;
  token: string;
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
    app: {
      name: 'embed-tableau-viz',
      sandboxCapabilities: {
        csp: {
          connectDomains: ['https://*.tableau.com'],
          resourceDomains: ['https://*.tableau.com'],
          frameDomains: ['https://*.tableau.com'],
        },
      },
    },
    callback: async ({ workbookId }, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();

      return await getWorkbookTool.logAndExecute<GetWorkbookResult>({
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

                const { config, tableauAuthInfo } = extra;
                let token = '';

                if (config.auth === 'direct-trust') {
                  token = await getJwt({
                    username: tableauAuthInfo?.username ?? config.jwtUsername,
                    config: {
                      type: 'connected-app',
                      clientId: config.connectedAppClientId,
                      secretId: config.connectedAppSecretId,
                      secretValue: config.connectedAppSecretValue,
                    },
                    scopes: new Set(['tableau:views:embed']),
                  });
                } else if (tableauAuthInfo?.type === 'Bearer' && tableauAuthInfo.raw) {
                  token = tableauAuthInfo.raw;
                }

                const viewName = workbook.views?.view.find(
                  (view) => view.id === workbook.defaultViewId,
                )?.name;
                const viewUrl = workbook.webpageUrl?.replace(
                  /\/workbooks\/.*$/,
                  `/views/${workbook.contentUrl}/${viewName}`,
                );
                return { workbook, url: viewUrl, token };
              },
            }),
          );
        },
        constrainSuccessResult: (result) =>
          filterWorkbookViews({ result, boundedContext: configWithOverrides.boundedContext }),
      });
    },
  });

  return getWorkbookTool;
};

export function filterWorkbookViews({
  result,
  boundedContext,
}: {
  result: GetWorkbookResult;
  boundedContext: BoundedContext;
}): ConstrainedResult<GetWorkbookResult> {
  const { workbook } = result;
  const { tags } = boundedContext;

  // We don't need to check the tags on the workbook since we already
  // did that before getting the detailed workbook information.
  // We only need to check the tags on the workbook's views.
  if (!workbook.views || !tags) {
    return {
      type: 'success',
      result,
    };
  }

  workbook.views.view = workbook.views.view.filter((view) =>
    view.tags?.tag?.some((tag) => tags.has(tag.label)),
  );

  return {
    type: 'success',
    result,
  };
}
