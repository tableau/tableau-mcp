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

export const getQueryAdminInsightsSiteContentTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const config = getConfig();
  const tool = new WebTool({
    server,
    name: 'query-admin-insights-site-content',
    disabled: !config.adminToolsEnabled,
    description: `
Queries the Admin Insights "Site Content" published datasource via the VizQL Data Service. Returns the
universe of content items (workbooks, datasources, views, flows, projects) on the current Tableau Cloud
site — including items that have never been accessed. This tool is restricted to Tableau site
administrators on Tableau Cloud sites with Admin Insights enabled.

Caller supplies a fully formed VDS \`query\` object (fields, filters, parameters). Common usage:
- Build a stale-content report: list all Workbooks and Datasources with Item ID, Item Name, Project, Owner Email,
  Created At, Updated At, Size — then anti-join against TS Events output.
- Inventory content per project or per owner.

Notes:
- The underlying datasource LUID is resolved automatically; callers do not pass datasourceLuid.
- This tool bypasses the standard datasource access checker because the dataset is internal
  and admin-gated.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Query Admin Insights — Site Content',
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
            datasetName: ADMIN_INSIGHTS_DATASETS.SITE_CONTENT,
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
