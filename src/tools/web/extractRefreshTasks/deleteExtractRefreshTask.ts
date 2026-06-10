import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { assertAdmin } from '../adminGate.js';
import { WebTool } from '../tool.js';

const paramsSchema = {
  taskId: z.string(),
};

export const getDeleteExtractRefreshTaskTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const deleteExtractRefreshTaskTool = new WebTool({
    server,
    name: 'delete-extract-refresh-task',
    disabled: !config.adminToolsEnabled,
    description: `
  Deletes an extract refresh task from the Tableau site. This permanently removes the scheduled extract refresh — the underlying data source or workbook is not affected, but it will no longer be refreshed on this schedule.

  This tool is restricted to Tableau site administrators and requires the \`ADMIN_TOOLS_ENABLED\` feature flag to be enabled.

  Use this tool when you need to:
  - Remove a scheduled extract refresh that is no longer needed
  - Disable refresh schedules for under-used or decommissioned content
  - Optimize site resources by eliminating unnecessary extract refreshes

  **Parameters:**
  - \`taskId\` (required) – The ID of the extract refresh task to delete. Obtain this from the \`list-extract-refresh-tasks\` tool.

  **Response:** A confirmation message indicating the task was successfully deleted.

  **Note:** This operation is irreversible. The extract refresh task cannot be recovered once deleted. To re-enable scheduled refreshes, a new task must be created. Tableau Cloud uses \`tableau:tasks:write\` scope.
  `,
    paramsSchema,
    annotations: {
      title: 'Delete Extract Refresh Task',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      return await deleteExtractRefreshTaskTool.logAndExecute<string>({
        extra,
        args,
        callback: async () => {
          await useRestApi({
            ...extra,
            jwtScopes: deleteExtractRefreshTaskTool.requiredApiScopes,
            callback: async (restApi) => {
              const adminResult = await assertAdmin(restApi, extra);
              if (adminResult.isErr()) {
                throw new Error(adminResult.error);
              }

              await restApi.tasksMethods.deleteExtractRefreshTask({
                siteId: restApi.siteId,
                taskId: args.taskId,
              });
            },
          });

          return new Ok(
            `Extract refresh task '${args.taskId}' has been successfully deleted. The underlying data source or workbook is unaffected, but it will no longer be refreshed on this schedule.`,
          );
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return deleteExtractRefreshTaskTool;
};
