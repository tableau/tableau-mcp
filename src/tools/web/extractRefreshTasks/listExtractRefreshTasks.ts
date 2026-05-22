import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { BoundedContext } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import { ExtractRefreshTask } from '../../../sdks/tableau/types/extractRefreshTask.js';
import { WebMcpServer } from '../../../server.web.js';
import { assertAdmin } from '../adminGate.js';
import { ConstrainedResult, WebTool } from '../tool.js';
import {
  applyTaskFilters,
  parseAndValidateExtractRefreshTasksFilterString,
} from './extractRefreshTasksFilterUtils.js';

const paramsSchema = {
  filter: z.string().optional(),
  pageSize: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
};

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

  This tool is restricted to Tableau site administrators and requires the \`ADMIN_TOOLS_ENABLED\` feature flag to be enabled.

  Use this tool when you need to:
  - See which data sources or workbooks have extract refresh schedules
  - Find the refresh schedule (frequency, next run) for specific datasources or workbooks
  - List all extract refresh tasks on the site
  - Analyze extract refresh patterns for schedule optimization

  **Parameters:**
  - \`filter\` (optional) – Client-side filter string with format \`field:operator:value\`. Multiple filters are comma-separated (AND logic). The Tableau REST API does not support server-side filtering, so all tasks are fetched and filtered client-side.
  - \`pageSize\` (optional) – Number of results per page (client-side pagination after filtering)
  - \`limit\` (optional) – Maximum total results to return (client-side limit after filtering)

  **Filterable Fields:**

  | Field | Type | Operators | Example |
  |-------|------|-----------|---------|
  | \`id\` | string | \`eq\`, \`in\` | \`id:eq:abc123\` |
  | \`type\` | string | \`eq\`, \`in\` | \`type:eq:RefreshExtractTask\` |
  | \`priority\` | number | \`eq\`, \`gt\`, \`gte\`, \`lt\`, \`lte\` | \`priority:gte:5\` |
  | \`consecutiveFailedCount\` | number | \`eq\`, \`gt\`, \`gte\`, \`lt\`, \`lte\` | \`consecutiveFailedCount:gt:0\` |
  | \`datasource.id\` | string | \`eq\`, \`in\` | \`datasource.id:eq:ds-123\` |
  | \`workbook.id\` | string | \`eq\`, \`in\` | \`workbook.id:eq:wb-456\` |
  | \`schedule.id\` | string | \`eq\`, \`in\` | \`schedule.id:eq:sched-789\` |
  | \`schedule.name\` | string | \`eq\`, \`in\` | \`schedule.name:eq:Daily Refresh\` |
  | \`schedule.state\` | string | \`eq\`, \`in\` | \`schedule.state:eq:Active\` |
  | \`schedule.frequency\` | string | \`eq\`, \`in\` | \`schedule.frequency:eq:Daily\` |
  | \`schedule.nextRunAt\` | string (ISO 8601) | \`eq\`, \`gt\`, \`gte\`, \`lt\`, \`lte\` | \`schedule.nextRunAt:lt:2026-05-25T00:00:00Z\` |
  | \`schedule.createdAt\` | string (ISO 8601) | \`eq\`, \`gt\`, \`gte\`, \`lt\`, \`lte\` | \`schedule.createdAt:gte:2026-01-01T00:00:00Z\` |
  | \`schedule.updatedAt\` | string (ISO 8601) | \`eq\`, \`gt\`, \`gte\`, \`lt\`, \`lte\` | \`schedule.updatedAt:gte:2026-05-01T00:00:00Z\` |

  **Filter Examples:**
  - Single filter: \`schedule.frequency:eq:Daily\`
  - Multiple filters (AND): \`schedule.frequency:eq:Daily,priority:gte:5\`
  - IN operator: \`schedule.frequency:in:Daily|Weekly\`

  **Response:** Each task includes:
  - \`id\` – extract refresh task ID
  - \`datasource.id\` or \`workbook.id\` – the target data source or workbook
  - \`schedule\` – frequency, nextRunAt, and (on Tableau Server) name, state, id

  **Note:** Tableau Cloud uses \`tableau:tasks:read\` scope. On Tableau Server, users see only tasks they own unless they are site or server administrators. The Tableau REST API does not support server-side filtering or pagination - all tasks are retrieved and filtering is performed client-side by this tool.
  `,
    paramsSchema,
    annotations: {
      title: 'List Extract Refresh Tasks',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();

      // Validate filter string early if provided
      if (args.filter) {
        parseAndValidateExtractRefreshTasksFilterString(args.filter);
      }

      return await listExtractRefreshTasksTool.logAndExecute({
        extra,
        args,
        callback: async () => {
          const tasks = await useRestApi({
            ...extra,
            jwtScopes: listExtractRefreshTasksTool.requiredApiScopes,
            callback: async (restApi) => {
              // Verify user has admin privileges
              const adminResult = await assertAdmin(restApi, extra);
              if (adminResult.isErr()) {
                throw new Error(adminResult.error);
              }

              return restApi.tasksMethods.listExtractRefreshTasks({
                siteId: restApi.siteId,
              });
            },
          });

          // Apply client-side filtering
          const filteredTasks = applyTaskFilters(tasks, args.filter);

          return new Ok(filteredTasks);
        },
        constrainSuccessResult: (tasks) =>
          constrainExtractRefreshTasks({
            tasks,
            boundedContext: configWithOverrides.boundedContext,
          }),
      });
    },
  });

  return listExtractRefreshTasksTool;
};

export function constrainExtractRefreshTasks({
  tasks,
  boundedContext,
}: {
  tasks: Array<ExtractRefreshTask>;
  boundedContext: BoundedContext;
}): ConstrainedResult<Array<ExtractRefreshTask>> {
  if (tasks.length === 0) {
    return {
      type: 'empty',
      message:
        'No extract refresh tasks were found. Either none exist or you do not have permission to view them.',
    };
  }

  const { datasourceIds, workbookIds } = boundedContext;
  const originalCount = tasks.length;

  // Filter by datasourceIds - only keep tasks for datasources in the allowed set
  if (datasourceIds) {
    tasks = tasks.filter(
      (task) => task.datasource?.id && datasourceIds.has(task.datasource.id),
    );
  }

  // Filter by workbookIds - only keep tasks for workbooks in the allowed set
  if (workbookIds) {
    tasks = tasks.filter((task) => task.workbook?.id && workbookIds.has(task.workbook.id));
  }

  if (tasks.length === 0 && originalCount > 0) {
    return {
      type: 'empty',
      message: [
        'The set of allowed extract refresh tasks is limited by the server configuration.',
        'While extract refresh tasks were found, they were all filtered out by the server configuration.',
      ].join(' '),
    };
  }

  if (tasks.length === 0) {
    return {
      type: 'empty',
      message:
        'No extract refresh tasks were found. Either none exist or you do not have permission to view them.',
    };
  }

  return { type: 'success', result: tasks };
};
