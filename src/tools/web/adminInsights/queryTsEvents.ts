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

export const getQueryAdminInsightsTsEventsTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const config = getConfig();
  const tool = new WebTool({
    server,
    name: 'query-admin-insights-ts-events',
    disabled: !config.adminToolsEnabled,
    description: `
Queries the Admin Insights "TS Events" published datasource via the VizQL Data Service. Use to retrieve
audit events (Access, Publish, Update, Delete, etc.) for content and users on the current Tableau Cloud site.
This tool is restricted to Tableau site administrators on Tableau Cloud sites with Admin Insights enabled.

Caller supplies a fully formed VDS \`query\` object (fields, filters, parameters). Common usage:
- Identify last-access timestamp per content item: filter Event Type to "Access", group by Item ID and Item Type,
  aggregate MAX(Event Date (UTC)).
- Audit which users last accessed a workbook within the 90-day window.

Notes:
- Tableau Cloud lookback is 90 days by default (365 days with Advanced Management).
- The underlying datasource LUID is resolved automatically; callers do not pass datasourceLuid.
- This tool bypasses the standard datasource access checker because the dataset is internal
  and admin-gated.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Query Admin Insights — TS Events',
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
            datasetName: ADMIN_INSIGHTS_DATASETS.TS_EVENTS,
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
