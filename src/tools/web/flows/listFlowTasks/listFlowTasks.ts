import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { BoundedContext } from '../../../../overridableConfig.js';
import { useRestApi } from '../../../../restApiInstance.js';
import { FlowRunTask } from '../../../../sdks/tableau/types/flowRunTask.js';
import { WebMcpServer } from '../../../../server.web.js';
import { ConstrainedResult, WebTool } from '../../tool.js';
import { buildTruncationInfo, ListFlowsTruncationReason } from '../listFlows/listFlows.js';
import {
  applyFlowTaskFilters,
  parseAndValidateFlowTasksFilterString,
} from './flowTasksFilterUtils.js';

const paramsSchema = {
  filter: z.string().optional(),
  pageSize: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
};

/**
 * Truncation reasons for list-flow-tasks. There is no `default-cap` (unlike
 * list-flow-runs): the Get Flow Run Tasks endpoint has no server-side paging,
 * so the whole set is always fetched and an unbounded call returns everything.
 */
export type ListFlowTasksResultInfo = {
  returnedCount: number;
  truncated: boolean;
  truncationReason?: ListFlowsTruncationReason;
  // Always known — every matching task is fetched before the limit is applied.
  totalAvailable: number;
};

/**
 * Wrapped result: `flowTasks` is the (possibly truncated) array and
 * `mcp.resultInfo` (always present) reports whether that array is complete.
 */
export type ListFlowTasksResult = {
  flowTasks: FlowRunTask[];
  mcp: {
    resultInfo: ListFlowTasksResultInfo;
  };
};

export const getListFlowTasksTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const listFlowTasksTool = new WebTool({
    server,
    name: 'list-flow-tasks',
    description: `
  Retrieves the scheduled flow run tasks on a Tableau site. A flow run task is the **schedule** for a Tableau Prep flow — when and how often it is configured to run — NOT a record of past executions (for run history use the \`list-flow-runs\` tool). Each task includes the target flow (\`flow.id\`, \`flow.name\`), the schedule (frequency, next run time, state), and the task \`id\` used to trigger an on-demand run.

  Use this tool to answer questions like:
  - "Which flows are scheduled, and how often do they run?"
  - "When does flow X run next?"
  - "Are any flow schedules suspended / failing repeatedly?"

  **Caller-role visibility**
  - **Non-admin** callers get the scheduled tasks only for flows they own.
  - **Admin** callers get every scheduled flow task on the site.

  **Parameters:**
  - \`filter\` (optional) – Client-side filter string \`field:operator:value\`. Multiple filters are comma-separated (AND logic). The Tableau REST API does not support server-side filtering for this endpoint, so all tasks are fetched and filtered client-side.
  - \`pageSize\` (optional) – Maximum results per page (client-side, applied after filtering).
  - \`limit\` (optional) – Maximum total results to return (client-side, applied after filtering).

  **Response-Size Guidance** — this endpoint has no server-side filtering or pagination, so the tool fetches **every** scheduled task on the site before applying \`filter\`/\`limit\`. On large sites that is a big, slow response, so favour narrow calls:
  - One flow's schedule: \`filter: "flow.id:eq:<uuid>"\`.
  - Only failing schedules: \`filter: "consecutiveFailedCount:gt:0"\`.
  - Only active daily schedules: \`filter: "schedule.frequency:eq:Daily,schedule.state:eq:Active"\`.
  - For a quick existence check ("are any flows scheduled?"), pass a small \`limit\` (e.g. 10).

  **Filterable Fields:**

  | Field | Type | Operators | Example |
  |-------|------|-----------|---------|
  | \`id\` | string | \`eq\`, \`in\` | \`id:eq:1bff10bb-57ae-43df-8774-a86d14aef432\` |
  | \`type\` | string | \`eq\`, \`in\` | \`type:eq:RunFlowTask\` |
  | \`priority\` | number | \`eq\`, \`gt\`, \`gte\`, \`lt\`, \`lte\` | \`priority:gte:5\` |
  | \`consecutiveFailedCount\` | number | \`eq\`, \`gt\`, \`gte\`, \`lt\`, \`lte\` | \`consecutiveFailedCount:gt:0\` |
  | \`flow.id\` | string | \`eq\`, \`in\` | \`flow.id:eq:8a320dca-9151-41ea-8474-a0bb71961cc0\` |
  | \`flow.name\` | string | \`eq\`, \`in\` | \`flow.name:eq:Daily Sales\` |
  | \`schedule.id\` | string | \`eq\`, \`in\` | \`schedule.id:eq:36d6fab2-2a0a-432e-b464-9fe4229a9937\` |
  | \`schedule.name\` | string | \`eq\`, \`in\` | \`schedule.name:eq:Daily Refresh\` |
  | \`schedule.state\` | string | \`eq\`, \`in\` | \`schedule.state:eq:Active\` |
  | \`schedule.frequency\` | string | \`eq\`, \`in\` | \`schedule.frequency:eq:Daily\` |
  | \`schedule.nextRunAt\` | string (ISO 8601) | \`eq\`, \`gt\`, \`gte\`, \`lt\`, \`lte\` | \`schedule.nextRunAt:lt:2026-05-25T00:00:00Z\` |
  | \`schedule.createdAt\` | string (ISO 8601) | \`eq\`, \`gt\`, \`gte\`, \`lt\`, \`lte\` | \`schedule.createdAt:gte:2026-01-01T00:00:00Z\` |
  | \`schedule.updatedAt\` | string (ISO 8601) | \`eq\`, \`gt\`, \`gte\`, \`lt\`, \`lte\` | \`schedule.updatedAt:gte:2026-05-01T00:00:00Z\` |

  **Filter Examples:**
  - Single filter: \`schedule.frequency:eq:Daily\`
  - Multiple filters (AND): \`schedule.frequency:eq:Daily,schedule.state:eq:Active\`
  - IN operator (bracket/comma list): \`schedule.state:in:[Active,Suspended]\` (pipe form \`Active|Suspended\` is also accepted)
  - Failing schedules: \`consecutiveFailedCount:gt:0\`

  **Response:** Returns \`{ flowTasks: [...], mcp: { resultInfo } }\`. Each task in \`flowTasks\` includes:
  - \`id\` – flow run task ID (use this as the task id to run the flow on demand)
  - \`flow.id\`, \`flow.name\` – the target flow
  - \`schedule\` – frequency, nextRunAt, state, name, and timestamps
  - \`priority\`, \`consecutiveFailedCount\`, \`type\`

  \`mcp.resultInfo\` is ALWAYS present and reports completeness: \`returnedCount\`, \`totalAvailable\` (the full count matching the filter — always known here because every task is fetched), \`truncated\`, and \`truncationReason\` (\`requested-limit\` | \`admin-cap\`).

  **Reporting to the user (every call):** translate \`mcp.resultInfo\` into one plain sentence — never say "resultInfo". \`truncated:false\` → "these are all N scheduled tasks". \`requested-limit\` → "showing the first N of M — say if you want the rest". \`admin-cap\` → "showing the first N of M; a site limit caps results per call — I can narrow the filter, or an admin can raise the cap". Also surface the **Caller-role visibility** limit when presenting results: non-admins see scheduled tasks ONLY for flows they **own** (not flows merely shared with them), so a scheduled flow they can see in the Tableau web UI may be missing here. Call this out especially on empty or unexpectedly short results. (Site/server administrators are exempt — they get every scheduled flow task, so do not state this limit to an admin caller.)

  **Note:** Requires Tableau REST API access scope \`tableau:flow_tasks:read\`. Date-time filter values must be full ISO 8601 (e.g. \`2026-05-25T00:00:00Z\`). The Tableau REST API does not support server-side filtering or pagination for this endpoint — all tasks are retrieved and filtered/limited client-side by this tool.
  `,
    paramsSchema,
    annotations: {
      title: 'List Flow Tasks',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();

      // Validate the filter string early so a malformed filter fails fast with a
      // clear error before any network call.
      if (args.filter) {
        parseAndValidateFlowTasksFilterString(args.filter);
      }

      return await listFlowTasksTool.logAndExecute<ListFlowTasksResult>({
        extra,
        args,
        callback: async () => {
          const tasks = await useRestApi({
            ...extra,
            jwtScopes: listFlowTasksTool.requiredApiScopes,
            callback: async (restApi) =>
              restApi.tasksMethods.getFlowRunTasks({
                siteId: restApi.siteId,
              }),
          });

          const filteredTasks = applyFlowTaskFilters(tasks, args.filter);
          // The whole matching set is in hand (the endpoint has no server-side
          // paging or filtering), so `totalAvailable` is always known exactly.
          const totalAvailable = filteredTasks.length;

          // Honor an admin MAX_RESULT_LIMIT alongside the caller's pageSize/limit
          // (consistent with list-flows / list-flow-runs). NOTE: because the whole
          // set is always fetched first, this cap only bounds the payload handed
          // back to the caller — it does not reduce server work or latency.
          const maxResultLimit = configWithOverrides.getMaxResultLimit(listFlowTasksTool.name);
          const callerLimit =
            args.limit !== undefined || args.pageSize !== undefined
              ? Math.min(
                  args.pageSize ?? Number.MAX_SAFE_INTEGER,
                  args.limit ?? Number.MAX_SAFE_INTEGER,
                )
              : undefined;
          const effectiveLimit = Math.min(
            callerLimit ?? Number.MAX_SAFE_INTEGER,
            maxResultLimit ?? Number.MAX_SAFE_INTEGER,
          );

          const limitedTasks =
            effectiveLimit < Number.MAX_SAFE_INTEGER
              ? filteredTasks.slice(0, effectiveLimit)
              : filteredTasks;

          // Signal completeness so the LLM never reports a capped list as the
          // full set (mirrors list-flows / list-flow-runs resultInfo).
          const { truncated, truncationReason } = buildTruncationInfo({
            truncatedByLimit: totalAvailable > limitedTasks.length,
            maxResultLimit,
            llmLimit: callerLimit,
            effectiveLimit,
          });

          return new Ok({
            flowTasks: limitedTasks,
            mcp: {
              resultInfo: {
                returnedCount: limitedTasks.length,
                truncated,
                ...(truncationReason && { truncationReason }),
                totalAvailable,
              },
            },
          } satisfies ListFlowTasksResult);
        },
        constrainSuccessResult: (result) =>
          constrainFlowTasks({
            result,
            boundedContext: configWithOverrides.boundedContext,
          }),
      });
    },
  });

  return listFlowTasksTool;
};

export function constrainFlowTasks({
  result,
  boundedContext,
}: {
  // Tolerates a missing `mcp.resultInfo` (treated as "complete") so unit tests
  // can pass a bare `{ flowTasks }`.
  result: { flowTasks: FlowRunTask[]; mcp?: { resultInfo?: ListFlowTasksResultInfo } };
  boundedContext: BoundedContext;
}): ConstrainedResult<ListFlowTasksResult> {
  // Fail closed: a flow run task carries the flow's id/name but no project or
  // tag, so when the server is restricted to a PROJECT_IDS / TAGS bounded
  // context we cannot prove a task's flow belongs to the allowed set. Refuse
  // rather than risk leaking schedules for flows outside the allow-list.
  // (datasource/workbook/view bounded contexts do not constrain flows.)
  const { projectIds, tags } = boundedContext;
  if (projectIds || tags) {
    return {
      type: 'empty',
      message: [
        'The set of content that can be queried is limited by the server configuration (an allowed-projects or tags bounded context is active).',
        'Flow run tasks are not associated with a project or tag, so this tool cannot verify that a task belongs to the allowed set and does not return flow tasks under this configuration.',
      ].join(' '),
    };
  }

  if (result.flowTasks.length === 0) {
    return {
      type: 'empty',
      message:
        'No flow run tasks were found. Either none are scheduled, none match the filter, or you do not have permission to view them.',
    };
  }

  const truncated = result.mcp?.resultInfo?.truncated ?? false;
  const truncationReason = result.mcp?.resultInfo?.truncationReason;
  const totalAvailable = result.mcp?.resultInfo?.totalAvailable ?? result.flowTasks.length;

  return {
    type: 'success',
    result: {
      flowTasks: result.flowTasks,
      mcp: {
        resultInfo: {
          returnedCount: result.flowTasks.length,
          truncated,
          ...(truncationReason && { truncationReason }),
          totalAvailable,
        },
      },
    },
  };
}
