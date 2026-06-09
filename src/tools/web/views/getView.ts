import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ViewNotAllowedError } from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { useRestApi } from '../../../restApiInstance.js';
import {
  getViewLineageByLuid,
  getViewLineageQuery,
  mergeViewLineage,
} from '../../../sdks/tableau/methods/lineageUtils.js';
import { View } from '../../../sdks/tableau/types/view.js';
import { WebMcpServer } from '../../../server.web.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { getAppConfig } from '../../../web/apps/appConfig.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';

const paramsSchema = {
  viewId: z.string(),
};

function constructViewWebUrl(server: string, siteName: string, contentUrl: string): string {
  // Remove '/sheets/' from contentUrl if present (API returns 'workbook/sheets/Sheet1', URL uses 'workbook/Sheet1')
  const urlPath = contentUrl.replace(/\/sheets\//, '/');
  return `${server}/#/site/${siteName}/views/${urlPath}`;
}

export const getViewTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const getViewTool = new WebTool({
    server,
    name: 'get-view',
    description:
      'Retrieves information about the specified view, including upstream datasources, workbook information, project details, owner, tags, and usage statistics.',
    paramsSchema,
    annotations: {
      title: 'Get View',
      readOnlyHint: true,
      openWorldHint: false,
    },
    app: getAppConfig('get-view'),
    callback: async ({ viewId }, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();

      return await getViewTool.logAndExecute<View>({
        extra,
        args: { viewId },
        callback: async () => {
          const isViewAllowedResult = await resourceAccessChecker.isViewAllowed({
            viewId,
            extra,
          });

          if (!isViewAllowedResult.allowed) {
            return new ViewNotAllowedError(isViewAllowedResult.message).toErr();
          }

          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: getViewTool.requiredApiScopes,
              callback: async (restApi) => {
                // Notice that we already have the view if it had been allowed by a project scope.
                const view =
                  isViewAllowedResult.content ??
                  (await restApi.viewsMethods.getView({
                    viewId,
                    siteId: restApi.siteId,
                    includeUsageStatistics: true,
                  }));

                if (configWithOverrides.disableMetadataApiRequests) {
                  return view;
                }

                try {
                  const response = await restApi.metadataMethods.graphql(
                    getViewLineageQuery([view.id]),
                  );
                  return mergeViewLineage(
                    [view],
                    getViewLineageByLuid(response),
                    configWithOverrides.boundedContext.datasourceIds,
                  )[0];
                } catch (error) {
                  log({
                    message: `Failed to enrich view ${view.id} with lineage metadata`,
                    level: 'warning',
                    logger: 'lineage',
                    data: getExceptionMessage(error),
                  });
                  return view;
                }
              },
            }),
          );
        },
        constrainSuccessResult: (view) => ({
          type: 'success',
          result: {
            ...view,
            webUrl: constructViewWebUrl(
              extra.config.server,
              extra.config.siteName,
              view.contentUrl,
            ),
          },
        }),
      });
    },
  });

  return getViewTool;
};
