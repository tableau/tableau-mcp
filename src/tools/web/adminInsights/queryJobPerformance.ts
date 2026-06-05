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

Caller supplies a fully formed VDS \`query\` object (fields, filters, parameters). Common usage:
- Analyze extract refresh durations and failure rates per datasource or workbook.
- Identify extracts with high consecutive failure counts or long run times.
- Compare scheduled frequency against actual job completion times to recommend schedule optimization.
- Find jobs that overlap or compete for resources in the same time window.

Key field captions include: Job ID, Job Type, Job Result, Item Name, Item Type, Started At,
Completed At, Job Duration, Job Execution Duration, Schedule Name, Owner Email, Extract File Size.
For the full list of 52 available fields, use \`get-datasource-metadata\` on the Job Performance
datasource or see the tool documentation.

The datasource exposes a Timezone parameter that adjusts local-time fields. Pass it inside
\`query.parameters\` as \`{ "parameterCaption": "Timezone", "dataType": "INTEGER", "value": -7 }\`.

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
