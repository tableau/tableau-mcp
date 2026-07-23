import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ViewNotAllowedError, WorkbookNotAllowedError } from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getAppConfig } from '../../../web/apps/appConfig.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { AppToolResult, WebTool } from '../tool.js';
import { constructViewWebUrl, getDefaultViewWebUrl } from '../utils/viewUrlUtils.js';

const paramsSchema = {
  luid: z
    .string()
    .nonempty()
    .describe('The LUID of the workbook or view to render as an interactive embedded viz.'),
  objectType: z
    .enum(['workbook', 'view'])
    .describe('Whether the luid refers to a "workbook" or a "view".'),
};

type RenderInteractiveVizResult = { luid: string; objectType: 'workbook' | 'view'; name: string };

export const getRenderInteractiveVizTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const renderInteractiveVizTool = new WebTool({
    server,
    name: 'render-interactive-viz',
    description: 'Renders the specified workbook or view as an interactive embedded Tableau viz.',
    paramsSchema,
    annotations: {
      title: 'Render Interactive Viz',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    app: getAppConfig('render-interactive-viz'),
    disabled: new Provider(async () => !(await getFeatureGate().isFeatureEnabled('mcp-apps'))),
    callback: async ({ luid, objectType }, extra): Promise<CallToolResult> => {
      return await renderInteractiveVizTool.logAndExecute<
        AppToolResult<RenderInteractiveVizResult>
      >({
        extra,
        args: { luid, objectType },
        callback: async () => {
          if (objectType === 'view') {
            const isViewAllowedResult = await resourceAccessChecker.isViewAllowed({
              viewId: luid,
              extra,
            });

            if (!isViewAllowedResult.allowed) {
              return new ViewNotAllowedError(isViewAllowedResult.message).toErr();
            }

            const view = await useRestApi({
              ...extra,
              jwtScopes: renderInteractiveVizTool.requiredApiScopes,
              callback: async (restApi) => {
                return (
                  isViewAllowedResult.content ??
                  (await restApi.viewsMethods.getView({
                    viewId: luid,
                    siteId: restApi.siteId,
                    includeUsageStatistics: false,
                  }))
                );
              },
            });

            const url = constructViewWebUrl(
              extra.config.server,
              extra.getSiteName(),
              view.contentUrl,
            );

            return new Ok({ data: { luid, objectType, name: view.name }, url });
          }

          // objectType === 'workbook'
          const isWorkbookAllowedResult = await resourceAccessChecker.isWorkbookAllowed({
            workbookId: luid,
            extra,
          });

          if (!isWorkbookAllowedResult.allowed) {
            return new WorkbookNotAllowedError(isWorkbookAllowedResult.message).toErr();
          }

          const workbook = await useRestApi({
            ...extra,
            jwtScopes: renderInteractiveVizTool.requiredApiScopes,
            callback: async (restApi) => {
              return (
                isWorkbookAllowedResult.content ??
                (await restApi.workbooksMethods.getWorkbook({
                  workbookId: luid,
                  siteId: restApi.siteId,
                }))
              );
            },
          });

          const url =
            getDefaultViewWebUrl(workbook, extra.config.server, extra.getSiteName()) ??
            workbook.webpageUrl ??
            '';

          return new Ok({ data: { luid, objectType, name: workbook.name }, url });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return renderInteractiveVizTool;
};
