import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Ok } from 'ts-results-es';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';

const paramsSchema = {};

export const getCreateWorkbookTool = (server: Server): Tool<typeof paramsSchema> => {
  const createWorkbookTool = new Tool({
    server,
    name: 'create-workbook',
    description: `Authors a workbook.`,
    paramsSchema,
    annotations: {
      title: 'Create Workbook',
      readOnlyHint: false, // This tool uploads files to the server
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (_, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();

      return await createWorkbookTool.logAndExecute({
        requestId,
        args: {},
        callback: async () => {
          return new Ok(
            await useRestApi({
              config,
              requestId,
              server,
              jwtScopes: ['tableau:file_uploads:create'],
              callback: async (restApi) => {
                const { uploadSessionId } = await restApi.publishingMethods.initiateFileUpload({
                  siteId: restApi.siteId,
                });

                const filename = 'superstore.twb';
                const path = join('src/tools/workbooks', filename);

                return await restApi.publishingMethods.appendToFileUpload({
                  siteId: restApi.siteId,
                  uploadSessionId,
                  filename,
                  fileBuffer: readFileSync(path),
                });
              },
            }),
          );
        },
        constrainSuccessResult: (uploadSession) => {
          return {
            type: 'success',
            result: uploadSession,
          };
        },
      });
    },
  });

  return createWorkbookTool;
};
