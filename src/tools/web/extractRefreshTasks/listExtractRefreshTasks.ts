import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { getConfig } from '../../../config.js';
import { useRestApi } from '../../../restApiInstance.js';
import { ExtractRefreshTask } from '../../../sdks/tableau/types/extractRefreshTask.js';
import { WebMcpServer } from '../../../server.web.js';
import { adminGate } from '../_lib/adminGate.js';
import { ConstrainedResult, WebTool } from '../tool.js';

const paramsSchema = {};

export const getListExtractRefreshTasksTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const listExtractRefreshTasksTool = new WebTool({
    server,
    name: 'list-extract-refresh-tasks',
    disabled: !config.adminToolsEnabled,
    description: `
  Retrieves a list of extract refresh tasks for the Tableau site. Each task describes a scheduled refresh for a **data source** or **workbook** extract and includes schedule information (e.g. frequency, next run time, schedule name on Server).

  This tool is restricted to Tableau site administrators and requires the \`TMCP_ADMIN_TOOLS_ENABLED\` feature flag to be enabled.

  Use this tool when you need to:
  - See which data sources or workbooks have extract refresh schedules
  - Find the refresh schedule (frequency, next run) for specific datasources or workbooks
  - List all extract refresh tasks on the site
  - Analyze extract refresh patterns for schedule optimization

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
              // Verify user has admin privileges
              await adminGate.assertAdmin(restApi);

              return restApi.tasksMethods.listExtractRefreshTasks({
                siteId: restApi.siteId,
              });
            },
          });
          return new Ok(tasks);
        },
        constrainSuccessResult: (
          tasks: ExtractRefreshTask[],
        ): ConstrainedResult<ExtractRefreshTask[]> => {
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
