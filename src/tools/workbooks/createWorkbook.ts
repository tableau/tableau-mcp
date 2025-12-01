import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { Ok } from 'ts-results-es';
import z from 'zod';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { getTableauAuthInfo } from '../../server/oauth/getTableauAuthInfo.js';
import { TableauAuthInfo } from '../../server/oauth/schemas.js';
import { isFeatureEnabled } from '../../utils/featureEnabledCache.js';
import invariant from '../../utils/invariant.js';
import { Provider } from '../../utils/provider.js';
import { Tool } from '../tool.js';

const paramsSchema = {
  workbookXml: z.string().trim().nonempty(),
};

export const getCreateWorkbookTool = (
  server: Server,
  authInfo?: TableauAuthInfo,
): Tool<typeof paramsSchema> => {
  const config = getConfig();
  const createWorkbookTool = new Tool({
    server,
    name: 'create-workbook',
    description:
      'Creates a Tableau workbook by uploading the TWB (workbook) XML string to the Tableau server. The workbook will be saved as a file with the given filename.',
    paramsSchema,
    disabled: new Provider(async () => {
      return !(await isFeatureEnabled({
        featureName: 'AuthoringNewWorkbookFromFileUpload',
        server: (config.server || authInfo?.server) ?? '',
        siteName: config.siteName,
      }));
    }),
    annotations: {
      title: 'Create Workbook',
      readOnlyHint: false, // This tool uploads files to the server
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async ({ workbookXml }, { requestId, authInfo }): Promise<CallToolResult> => {
      const config = getConfig();

      return await createWorkbookTool.logAndExecute({
        requestId,
        authInfo,
        args: { workbookXml },
        callback: async () => {
          const tableauAuthInfo = getTableauAuthInfo(authInfo);
          return new Ok(
            await useRestApi({
              config,
              requestId,
              server,
              jwtScopes: ['tableau:file_uploads:create'],
              authInfo: tableauAuthInfo,
              callback: async (restApi) => {
                const { uploadSessionId } = await restApi.publishingMethods.initiateFileUpload({
                  siteId: restApi.siteId,
                });

                const result = await restApi.publishingMethods.appendToFileUpload({
                  siteId: restApi.siteId,
                  uploadSessionId,
                  filename: `${randomUUID()}.twb`,
                  contents: Buffer.from(workbookXml),
                });

                if (result.isErr()) {
                  return result;
                }

                const server = config.server || tableauAuthInfo?.server;
                invariant(server, 'Tableau server could not be determined');
                return new Ok(
                  `${server}/vizql/show${config.siteName ? `/t/${config.siteName}` : ''}/authoring/newWorkbook/${randomUUID()}/fromFileUpload/${uploadSessionId}`,
                );
              },
            }),
          );
        },
        constrainSuccessResult: (uploadSessionId) => {
          return {
            type: 'success',
            result: uploadSessionId,
          };
        },
      });
    },
  });

  return createWorkbookTool;
};
