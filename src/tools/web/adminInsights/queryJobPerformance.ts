import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { querySchema } from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import { runAdminInsightsQuery } from './adminInsightsToolBase.js';
import { ADMIN_INSIGHTS_DATASETS } from './resolver.js';

const paramsSchema = {
  query: querySchema,
  limit: z.number().int().min(1).optional(),
};

export const getQueryAdminInsightsJobPerformanceTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const config = getConfig();
  const tool = new WebTool({
    server,
    name: 'query-admin-insights-job-performance',
    disabled: !config.adminToolsEnabled,
    description: `
Queries the Admin Insights "Job Performance" published datasource via the VizQL Data Service. Returns
records of extract refresh jobs, subscription jobs, flow runs, and bridge jobs on the current Tableau
Cloud site. This tool is restricted to Tableau site administrators on Tableau Cloud sites with Admin
Insights enabled.

Caller supplies a fully formed VDS \`query\` object with at least one entry in \`fields\`. Each field
uses \`fieldCaption\` matching the column names below. Common usage:
- Analyze extract refresh durations and failure rates per datasource or workbook.
- Identify extracts with high consecutive failure counts or long run times.
- Compare scheduled frequency against actual job completion times to recommend schedule optimization.
- Find jobs that overlap or compete for resources in the same time window.

Available field captions (use exact names with \`fieldCaption\`):
- **Job identity**: Job ID, Job LUID, Job Type, Job Result, Final Job Result
- **Item details**: Item ID, Item LUID, Item Name, Item Type, Item Hyperlink
- **Timing (UTC)**: Created At, Queued At, Started At, Completed At, Overflow Queued At
- **Timing (local)**: Created At (local), Queued At (local), Started At (local), Completed At (local), Overflow Queued At (local)
- **Durations (seconds)**: Job Duration, Job Execution Duration, Job Queued Duration, Job Overflow Queued Duration
- **Schedule**: Schedule Name, Schedule LUID
- **Owner/Project**: Owner Email, Parent Project Name, Parent Project Owner Email
- **Extract**: Extract File Size
- **Subscription**: Subscriber Email, Subscriber ID, Subscription Subject
- **Bridge**: Agent Name, Agent Version, Agent Timezone, Agent is Pooled?, Pool Name, Bridge Started At, Bridge Completed At, Bridge Started At (Local), Bridge Completed At (Local), Bridge Refresh Duration, Bridge Extract Upload Duration, Bridge Job Result, Bridge Error Message, Bridge Error Type, Bridge Initiator User Name
- **Flags**: Was Manual Run, Was Overflow Queued
- **Other**: Error Message, Admin Insights Published At

Parameters: Timezone (integer offset, e.g. -7 for PDT)

Example query:
\`\`\`json
{
  "fields": [
    { "fieldCaption": "Item Name" },
    { "fieldCaption": "Job Type" },
    { "fieldCaption": "Job Result" },
    { "fieldCaption": "Started At" },
    { "fieldCaption": "Job Duration" },
    { "fieldCaption": "Schedule Name" }
  ],
  "filters": [
    {
      "field": { "fieldCaption": "Job Type" },
      "filterType": "SET",
      "values": ["Refresh Extracts"],
      "exclude": false
    }
  ]
}
\`\`\`

Notes:
- The \`query.fields\` array must contain at least one field — omitting it causes a VDS error.
- Tableau Cloud lookback is 90 days by default (365 days with Advanced Management).
- The underlying datasource LUID is resolved automatically; callers do not pass datasourceLuid.
- This tool bypasses the standard datasource access checker because the dataset is internal
  and admin-gated.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Query Admin Insights — Job Performance',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ query, limit }, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();
      return await tool.logAndExecute({
        extra,
        args: { query, limit },
        callback: async () => {
          const maxResultLimit = configWithOverrides.getMaxResultLimit(tool.name);
          const rowLimit = maxResultLimit
            ? Math.min(maxResultLimit, limit ?? Number.MAX_SAFE_INTEGER)
            : limit;

          return await runAdminInsightsQuery({
            extra,
            jwtScopes: tool.requiredApiScopes,
            datasetName: ADMIN_INSIGHTS_DATASETS.JOB_PERFORMANCE,
            query,
            rowLimit,
          });
        },
        constrainSuccessResult: (queryOutput) => ({ type: 'success', result: queryOutput }),
      });
    },
  });

  return tool;
};
