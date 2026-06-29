// MCP tool: list background jobs (extract refreshes, subscriptions, flow runs).
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { useRestApi } from '../../../restApiInstance.js';
import { Job } from '../../../sdks/tableau/types/job.js';
import { WebMcpServer } from '../../../server.web.js';
import { assertAdmin } from '../adminGate.js';
import { ConstrainedResult, WebTool } from '../tool.js';
import { parseAndValidateJobsFilterString } from './jobsFilterUtils.js';

const paramsSchema = {
  filter: z.string().optional(),
  pageSize: z.number().int().positive().max(1000).optional(),
  pageNumber: z.number().int().positive().optional(),
};

export const getListJobsTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const listJobsTool = new WebTool({
    server,
    name: 'list-jobs',
    disabled: !config.adminToolsEnabled,
    description: `
  Retrieves a list of background jobs for the Tableau site. Each job represents a background task such as an extract refresh, subscription delivery, flow run, or other asynchronous operations.

  This tool is restricted to Tableau site administrators and requires the \`ADMIN_TOOLS_ENABLED\` feature flag to be enabled.

  Use this tool when you need to:
  - Monitor the status of background jobs (extract refreshes, subscriptions, flows)
  - Find failed or in-progress jobs
  - Investigate job history and performance
  - Check job completion times and progress
  - Troubleshoot extract refresh or subscription failures

  **Parameters:**
  - \`filter\` (optional) – Server-side filter string with format \`field:operator:value\`. Multiple filters are comma-separated (AND logic). Sent directly to the Tableau REST API.
  - \`pageSize\` (optional) – Number of results per page (max 1000, default 100)
  - \`pageNumber\` (optional) – Page number (default 1)

  **Filterable Fields (server-side):**

  | Field | Type | Operators | Example |
  |-------|------|-----------|---------|
  | \`jobType\` | string | \`eq\`, \`in\` | \`jobType:eq:refresh_extracts\` |
  | \`status\` | string | \`eq\` | \`status:eq:Failed\` |
  | \`progress\` | number | \`eq\`, \`gt\`, \`gte\`, \`lt\`, \`lte\` | \`progress:lte:0\` |
  | \`priority\` | number | \`eq\`, \`gt\`, \`gte\`, \`lt\`, \`lte\` | \`priority:lte:10\` |
  | \`title\` | string | \`eq\`, \`has\` | \`title:has:Superstore\` |
  | \`subtitle\` | string | \`eq\`, \`has\` | \`subtitle:has:weekly\` |
  | \`notes\` | string | \`has\` | \`notes:has:nightly\` |
  | \`args\` | string | \`has\` | \`args:has:datasource\` |
  | \`createdAt\` | string (ISO 8601) | \`eq\`, \`gt\`, \`gte\`, \`lt\`, \`lte\` | \`createdAt:gt:2026-05-01T00:00:00Z\` |
  | \`startedAt\` | string (ISO 8601) | \`eq\`, \`gt\`, \`gte\`, \`lt\`, \`lte\` | \`startedAt:gte:2026-05-01T00:00:00Z\` |
  | \`completedAt\` | string (ISO 8601) | \`eq\`, \`gt\`, \`gte\`, \`lt\`, \`lte\` | \`completedAt:lt:2026-05-25T00:00:00Z\` |

  **Filter Examples:**
  - Single filter: \`jobType:eq:refresh_extracts\`
  - Multiple filters (AND): \`jobType:eq:refresh_extracts,progress:lte:0\`
  - In operator (bracketed list): \`jobType:in:[refresh_extracts,run_flow]\`
  - Text search: \`title:has:Superstore\`
  - Date filter: \`createdAt:gt:2026-05-01T00:00:00Z\`

  **Common Job Types:** \`refresh_extracts\`, \`increment_extracts\`, \`subscription\`, \`run_flow\`

  **Common Statuses:** Success, Failed, InProgress, Pending, Cancelled

  **Response:** Each job includes:
  - \`id\` – job ID
  - \`status\` – current status
  - \`jobType\` – type of job (refresh_extracts, run_flow, etc.)
  - \`priority\` – job priority
  - \`createdAt\`, \`startedAt\`, \`endedAt\` – timestamps
  - \`progress\` – completion percentage
  - \`title\` – human-readable description

  **Note:** Requires \`tableau:jobs:read\` scope (API 3.27+). This tool requires site administrator permissions. Filtering and pagination are handled server-side by the Tableau REST API.
  `,
    paramsSchema,
    annotations: {
      title: 'List Jobs',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      return await listJobsTool.logAndExecute({
        extra,
        args,
        callback: async () => {
          if (args.filter) {
            parseAndValidateJobsFilterString(args.filter);
          }
          const result = await useRestApi({
            ...extra,
            jwtScopes: listJobsTool.requiredApiScopes,
            callback: async (restApi) => {
              const adminResult = await assertAdmin(restApi, extra);
              if (adminResult.isErr()) {
                throw new Error(adminResult.error);
              }

              return restApi.jobsMethods.listJobs({
                siteId: restApi.siteId,
                filter: args.filter,
                pageSize: args.pageSize,
                pageNumber: args.pageNumber,
              });
            },
          });

          return new Ok(result.jobs);
        },
        constrainSuccessResult: (jobs) => constrainJobs(jobs),
      });
    },
  });

  return listJobsTool;
};

export function constrainJobs(jobs: Array<Job>): ConstrainedResult<Array<Job>> {
  if (jobs.length === 0) {
    return {
      type: 'empty',
      message:
        'No jobs were found. Either none exist matching the criteria or you do not have permission to view them.',
    };
  }

  return { type: 'success', result: jobs };
}
