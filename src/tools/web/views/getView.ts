import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ViewNotAllowedError } from '../../../errors/mcpToolError.js';
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
import { AppToolResult, WebTool } from '../tool.js';
import { constructViewWebUrl } from '../utils/viewUrlUtils.js';

const paramsSchema = {
  viewId: z.string(),
};

export const getGetViewTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const getViewTool = new WebTool({
    server,
    name: 'get-view',
    description:
      'Retrieves information about the specified view, including upstream datasources, workbook information, project details, owner, tags, and usage statistics.',
    paramsSchema,
    annotations: {
      title: 'Get View',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    app: getAppConfig('get-view'),
    callback: async ({ viewId }, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();

      return await getViewTool.logAndExecute<AppToolResult<View>>({
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

          const view = await useRestApi({
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
                extra.logger.log({
                  message: `Failed to enrich view ${view.id} with lineage metadata`,
                  level: 'warning',
                  logger: 'lineage',
                  data: getExceptionMessage(error),
                });
                return view;
              }
            },
          });

          const url = constructViewWebUrl(
            extra.config.server,
            extra.getSiteName(),
            view.contentUrl,
          );
          return new Ok({
            data: view,
            url,
          });
        },
        constrainSuccessResult: (result) => ({
          type: 'success',
          result,
        }),
      });
    },
  });

  return getViewTool;
};
