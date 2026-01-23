import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { Server } from '../../server.js';
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
  type: 'workbook-not-allowed';
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
    callback: async ({ workbookId }, { requestId, authInfo, signal }): Promise<CallToolResult> => {
      const config = getConfig();

      return await createWorkbookSessionTool.logAndExecute<string, CreateWorkbookSessionError>({
        requestId,
        authInfo,
        args: { workbookId },
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

          return Ok('success');
        },
        constrainSuccessResult: (workbook) => {
          return {
            type: 'success',
            result: workbook,
          };
        },
        getErrorText: (error: CreateWorkbookSessionError) => {
          switch (error.type) {
            case 'workbook-not-allowed':
              return error.message;
          }
        },
      });
    },
  });

  return createWorkbookSessionTool;
};
