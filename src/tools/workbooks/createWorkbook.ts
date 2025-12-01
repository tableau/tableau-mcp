import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import z from 'zod';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { getTableauAuthInfo } from '../../server/oauth/getTableauAuthInfo.js';
import { TableauAuthInfo } from '../../server/oauth/schemas.js';
import { isFeatureEnabled } from '../../utils/featureEnabledCache.js';
import { Provider } from '../../utils/provider.js';
import { Tool } from '../tool.js';

const paramsSchema = {
  workbookXml: z.string().trim().nonempty(),
  workbookFilename: z.string().trim().nonempty(),
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
      }));
    }),
    annotations: {
      title: 'Create Workbook',
      readOnlyHint: false, // This tool uploads files to the server
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (
      { workbookXml, workbookFilename },
      { requestId, authInfo },
    ): Promise<CallToolResult> => {
      const config = getConfig();

      return await createWorkbookTool.logAndExecute({
        requestId,
        authInfo,
        args: { workbookXml, workbookFilename },
        callback: async () => {
          return new Ok(
            await useRestApi({
              config,
              requestId,
              server,
              jwtScopes: ['tableau:file_uploads:create'],
              authInfo: getTableauAuthInfo(authInfo),
              callback: async (restApi) => {
                const { uploadSessionId } = await restApi.publishingMethods.initiateFileUpload({
                  siteId: restApi.siteId,
                });

                const result = await restApi.publishingMethods.appendToFileUpload({
                  siteId: restApi.siteId,
                  uploadSessionId,
                  filename: workbookFilename,
                  contents: Buffer.from(workbookXml),
                });

                if (result.isErr()) {
                  return result;
                }

                return new Ok(result.value.uploadSessionId);
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
