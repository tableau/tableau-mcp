import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { BoundedContext } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import { Schedule } from '../../../sdks/tableau/types/schedule.js';
import { WebMcpServer } from '../../../server.web.js';
import { assertAdmin } from '../adminGate.js';
import { ConstrainedResult, WebTool } from '../tool.js';
import { aggregateSchedulesFromTasks, applySchedulesFilters } from './schedulesUtils.js';

const paramsSchema = {
  filter: z.string().optional(),
  pageSize: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
};

export const getListSchedulesTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const listSchedulesTool = new WebTool({
    server,
    name: 'list-schedules',
    disabled: !config.adminToolsEnabled,
    description: `
  Retrieves the list of schedules in use on the Tableau site. Each schedule describes when extracts refresh (e.g. frequency, next run time) and includes aggregation metadata: how many extract refresh tasks run on it (\`taskCount\`) and which data sources and workbooks those tasks target.

  This tool is restricted to Tableau site administrators and requires the \`ADMIN_TOOLS_ENABLED\` feature flag to be enabled.

  Use this tool when you need to:
  - Enumerate the distinct refresh schedules configured on the site
  - See how many tasks (and which content) share a given schedule
  - Analyze schedule usage for extract refresh schedule optimization

  **Parameters:**
  - \`filter\` (optional) – Client-side filter string with format \`field:operator:value\`. Multiple filters are comma-separated (AND logic).
  - \`pageSize\` (optional) – Reserved for future server-side pagination; currently informational.
  - \`limit\` (optional) – Maximum total schedules to return (client-side limit after filtering).

  **Filterable Fields:**

  | Field | Type | Operators | Example |
  |-------|------|-----------|---------|
  | \`id\` | string | \`eq\`, \`in\` | \`id:eq:sched-123\` |
  | \`name\` | string | \`eq\`, \`in\` | \`name:eq:Daily Refresh\` |
  | \`type\` | string | \`eq\`, \`in\` | \`type:eq:Extract\` |
  | \`state\` | string | \`eq\`, \`in\` | \`state:eq:Active\` |
  | \`frequency\` | string | \`eq\`, \`in\` | \`frequency:eq:Daily\` |
  | \`priority\` | number | \`eq\`, \`gt\`, \`gte\`, \`lt\`, \`lte\` | \`priority:gte:5\` |
  | \`taskCount\` | number | \`eq\`, \`gt\`, \`gte\`, \`lt\`, \`lte\` | \`taskCount:gt:1\` |
  | \`nextRunAt\` | string (ISO 8601) | \`eq\`, \`gt\`, \`gte\`, \`lt\`, \`lte\` | \`nextRunAt:lt:2026-05-25T00:00:00Z\` |
  | \`createdAt\` | string (ISO 8601) | \`eq\`, \`gt\`, \`gte\`, \`lt\`, \`lte\` | \`createdAt:gte:2026-01-01T00:00:00Z\` |
  | \`updatedAt\` | string (ISO 8601) | \`eq\`, \`gt\`, \`gte\`, \`lt\`, \`lte\` | \`updatedAt:gte:2026-05-01T00:00:00Z\` |

  **Filter Examples:**
  - Single filter: \`frequency:eq:Daily\`
  - Multiple filters (AND): \`frequency:eq:Daily,taskCount:gt:1\`
  - IN operator: \`frequency:in:Daily|Weekly\`

  **Note:** Tableau Cloud does not expose a standalone schedules collection (the \`GET /sites/{siteId}/schedules\` and server-level \`GET /schedules\` endpoints are Tableau Server only). This tool derives the schedule universe by aggregating the distinct schedules referenced by the site's extract refresh tasks via \`tableau:tasks:read\`. Filtering and limiting are performed client-side.
  `,
    paramsSchema,
    annotations: {
      title: 'List Schedules',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();

      return await listSchedulesTool.logAndExecute({
        extra,
        args,
        callback: async () => {
          const tasks = await useRestApi({
            ...extra,
            jwtScopes: listSchedulesTool.requiredApiScopes,
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

          // Aggregate distinct schedules, then apply client-side filtering and limit
          const schedules = aggregateSchedulesFromTasks(tasks);
          const filteredSchedules = applySchedulesFilters(schedules, args.filter);
          const limitedSchedules =
            args.limit !== undefined ? filteredSchedules.slice(0, args.limit) : filteredSchedules;

          return new Ok(limitedSchedules);
        },
        constrainSuccessResult: (schedules) =>
          constrainSchedules({
            schedules,
            boundedContext: configWithOverrides.boundedContext,
          }),
      });
    },
  });

  return listSchedulesTool;
};

export function constrainSchedules({
  schedules,
  boundedContext,
}: {
  schedules: Array<Schedule>;
  boundedContext: BoundedContext;
}): ConstrainedResult<Array<Schedule>> {
  if (schedules.length === 0) {
    return {
      type: 'empty',
      message:
        'No schedules were found. Either none exist or you do not have permission to view them.',
    };
  }

  const { datasourceIds, workbookIds } = boundedContext;

  // Keep only schedules that touch at least one allowed data source / workbook.
  if (datasourceIds) {
    schedules = schedules.filter((schedule) =>
      schedule.datasourceIds?.some((id) => datasourceIds.has(id)),
    );
  }

  if (workbookIds) {
    schedules = schedules.filter((schedule) =>
      schedule.workbookIds?.some((id) => workbookIds.has(id)),
    );
  }

  if (schedules.length === 0) {
    return {
      type: 'empty',
      message: [
        'The set of allowed schedules is limited by the server configuration.',
        'While schedules were found, they were all filtered out by the server configuration.',
      ].join(' '),
    };
  }

  return { type: 'success', result: schedules };
}
