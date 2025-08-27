import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { Server } from '../server.js';
import { isTaskName, taskNames, taskNamesToTools } from './taskName.js';
import { Tool } from './tool.js';
import { isToolGroupName, isToolName, toolGroups } from './toolName.js';

const paramsSchema = {
  taskName: z.enum(taskNames),
};

export const getStartTaskTool = (server: Server): Tool<typeof paramsSchema> => {
  const startTaskTool = new Tool({
    server,
    name: 'start-task',
    description: `Starts a task with the specified name.`,
    paramsSchema,
    annotations: {
      title: 'Start Task',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ taskName }, { requestId }): Promise<CallToolResult> => {
      return await startTaskTool.logAndExecute({
        requestId,
        args: { taskName },
        callback: async () => {
          if (!isTaskName(taskName)) {
            return new Err(`Invalid task name, must be one of: ${taskNames.join(', ')}`);
          }

          const includeTools = taskNamesToTools[taskName].flatMap((toolName) =>
            isToolName(toolName) ? toolName : isToolGroupName(toolName) ? toolGroups[toolName] : [],
          );

          server.registerTools({
            includeTools: [...includeTools, 'complete-task'],
          });

          return new Ok('success');
        },
        getErrorText: (error) => error,
      });
    },
  });

  return startTaskTool;
};
