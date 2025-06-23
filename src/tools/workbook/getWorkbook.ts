import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';

const paramsSchema = {
  workbookId: z.string(),
};

export const getGetWorkbookTool = (server: Server): Tool<typeof paramsSchema> => {
  const getWorkbookTool = new Tool({
    server,
    name: 'get-workbook',
    description: `Returns information about the specified workbook, including information about views and tags.`,
    paramsSchema,
    annotations: {
      title: 'Get Workbook',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ workbookId }, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();

      return await getWorkbookTool.logAndExecute({
        requestId,
        args: { workbookId },
        callback: async () => {
          return new Ok(
            await useRestApi(
              config.server,
              config.authConfig,
              requestId,
              server,
              async (restApi) => {
                return await restApi.workbookMethods.getWorkbook(workbookId);
              },
            ),
          );
        },
      });
    },
  });

  return getWorkbookTool;
};
