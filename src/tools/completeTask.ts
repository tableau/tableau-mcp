import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { Server } from '../server.js';
import { Tool } from './tool.js';

const paramsSchema = {};

export const getCompleteTaskTool = (server: Server): Tool<typeof paramsSchema> => {
  const completeTaskTool = new Tool({
    server,
    name: 'complete-task',
    description: `Completes a task.`,
    paramsSchema,
    annotations: {
      title: 'Complete Task',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (_, { requestId }): Promise<CallToolResult> => {
      return await completeTaskTool.logAndExecute({
        requestId,
        args: {},
        callback: async () => {
          server.registerTools({
            includeTools: ['start-task'],
          });

          return new Ok('success');
        },
      });
    },
  });

  return completeTaskTool;
};
