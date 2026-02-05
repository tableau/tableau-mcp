import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import { useHeaderExtractorPlugin } from '../../sdks/plugins/headerExtractorPlugin.js';
import { Server } from '../../server.js';
import { getTableauAuthInfo } from '../../server/oauth/getTableauAuthInfo.js';
import { getNewVizqlApiInstanceAsync } from '../../vizqlApiInstance.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { Tool } from '../tool.js';

const paramsSchema = {
  workbookId: z.string().describe('The ID of the workbook to create a session for.'),
  viewId: z
    .string()
    .optional()
    .describe(
      'The ID of the view to create a session for. If not provided, the default view of the workbook will be used.',
    ),
};

export type CreateWorkbookSessionError = {
  type: 'workbook-not-allowed' | 'view-not-found';
  message: string;
};

export const getCreateWorkbookSessionTool = (server: Server): Tool<typeof paramsSchema> => {
  const createWorkbookSessionTool = new Tool({
    server,
    name: 'create-workbook-session',
    description:
      'Creates a session for the specified workbook. If a view ID is provided, the session will be created for the specified view. If no view ID is provided, the session will be created for the default view of the workbook.',
    paramsSchema,
    annotations: {
      title: 'Create Workbook Session',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (
      { workbookId, viewId },
      { requestId, authInfo, signal },
    ): Promise<CallToolResult> => {
      const config = getConfig();

      return await createWorkbookSessionTool.logAndExecute<
        { sessionid: string; globalSessionHeader: string | null },
        CreateWorkbookSessionError
      >({
        requestId,
        authInfo,
        args: { workbookId, viewId },
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

          const result = await useRestApi({
            config,
            requestId,
            server,
            jwtScopes: ['tableau:content:read'],
            signal,
            callback: async (restApi) => {
              const workbook = await restApi.workbooksMethods.getWorkbook({
                siteId: restApi.siteId,
                workbookId,
              });

              const workbookName = workbook.name;
              const viewName = workbook.defaultViewId
                ? workbook.views?.view.find((v) => v.id === workbook.defaultViewId)?.name
                : undefined;

              if (!viewName) {
                return new Err({
                  type: 'view-not-found',
                  message: 'No view ID provided and no default view for workbook found.',
                } as const);
              }

              const vizqlClient = await getNewVizqlApiInstanceAsync({
                baseUrl: config.server || getTableauAuthInfo(authInfo)?.server || '',
                requestId,
                server,
                maxRequestTimeoutMs: config.maxRequestTimeoutMs,
                signal,
              });

              const {
                result: { sessionid },
                headerValue: globalSessionHeader,
              } = await useHeaderExtractorPlugin({
                client: vizqlClient,
                headerName: 'global-session-header',
                timeoutMs: config.maxRequestTimeoutMs,
                signal,
                clientCallback: async (client) => {
                  return await client.startSession(undefined, {
                    params: {
                      siteName: config.siteName,
                      workbookName,
                      viewName,
                    },
                    headers: {
                      Cookie: `workgroup_session_id=${restApi.creds.token};`,
                    },
                  });
                },
              });

              return new Ok({
                sessionid,
                globalSessionHeader,
              });
            },
          });

          return result;
        },
        constrainSuccessResult: (result) => {
          return {
            type: 'success',
            result,
          };
        },
        getErrorText: (error: CreateWorkbookSessionError) => {
          switch (error.type) {
            case 'workbook-not-allowed':
              return error.message;
            case 'view-not-found':
              return error.message;
          }
        },
      });
    },
  });

  return createWorkbookSessionTool;
};
