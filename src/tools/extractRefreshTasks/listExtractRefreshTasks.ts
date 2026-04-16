import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../restApiInstance.js';
import { ExtractRefreshTask } from '../../sdks/tableau/types/extractRefreshTask.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';

const paramsSchema = {};

export const getListExtractRefreshTasksTool = (server: Server): Tool<typeof paramsSchema> => {
  const listExtractRefreshTasksTool = new Tool({
    server,
    name: 'list-extract-refresh-tasks',
    description: `
  Retrieves a list of extract refresh tasks for the Tableau site. Each task describes a scheduled refresh for a **data source** or **workbook** extract and includes schedule information (e.g. frequency, next run time, schedule name on Server).

  Use this tool when you need to:
  - See which data sources or workbooks have extract refresh schedules
  - Find the refresh schedule (frequency, next run) for specific datasources or workbooks
  - List all extract refresh tasks on the site

  **Response:** Each task includes:
  - \`id\` – extract refresh task ID
  - \`datasource.id\` or \`workbook.id\` – the target data source or workbook
  - \`schedule\` – frequency, nextRunAt, and (on Tableau Server) name, state, id

  **Note:** Tableau Cloud uses \`tableau:tasks:read\` scope. On Tableau Server, users see only tasks they own unless they are site or server administrators.
  `,
    paramsSchema,
    annotations: {
      title: 'List Extract Refresh Tasks',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (_args, extra): Promise<CallToolResult> => {
      return await listExtractRefreshTasksTool.logAndExecute({
        extra,
        args: {},
        callback: async () => {
          const tasks = await useRestApi({
            ...extra,
            jwtScopes: listExtractRefreshTasksTool.requiredApiScopes,
            callback: async (restApi) => {
              return restApi.tasksMethods.listExtractRefreshTasks({
                siteId: restApi.siteId,
              });
            },
          });
          return new Ok(tasks);
        },
        constrainSuccessResult: (tasks: ExtractRefreshTask[]) => {
          if (tasks.length === 0) {
            return {
              type: 'empty',
              message:
                'No extract refresh tasks were found. Either none exist or you do not have permission to view them.',
            };
          }
          return { type: 'success', result: tasks };
        },
      });
    },
  });

  return listExtractRefreshTasksTool;
};
