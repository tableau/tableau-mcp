import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { Server } from '../server.js';
import { Tool } from './tool.js';

const paramsSchema = {
  server: z.string(),
  siteName: z.string(),
};

export const getStartTaskTool = (server: Server): Tool<typeof paramsSchema> => {
  const startTaskTool = new Tool({
    server,
    name: 'connect-to-site',
    description: 'Starts a task with the specified name.',
    paramsSchema,
    annotations: {
      title: 'Start Task',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ server, siteName }, { requestId, authInfo }): Promise<CallToolResult> => {
      return await startTaskTool.logAndExecute({
        requestId,
        authInfo,
        args: { server, siteName },
        callback: async () => {
          return new Ok('success');
        },
      });
    },
  });

  return startTaskTool;
};
