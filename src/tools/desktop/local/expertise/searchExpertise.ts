import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { searchExpertiseWithFallback } from '../../../../desktop/expertise/index.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { DesktopTool } from '../../tool.js';

const paramsSchema = {
  query: z.string().describe('Task or topic (e.g. "top 10 by category")'),
  limit: z.number().int().positive().optional().describe('Max results (default 5)'),
};

const toolTitle = 'Search Expertise';
export const getSearchExpertiseTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'search-expertise',
    title: toolTitle,
    description:
      "Search Tableau authoring guidance by concept: chart choice, calculation patterns, workbook structure, and dashboard layout. When topHitBody is present, it is the full module; no follow-up read is needed. Otherwise read the top hit's mustReadUri.",
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ query, limit }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { query, limit },
        callback: async () => {
          return new Ok(searchExpertiseWithFallback(query, limit));
        },
        getSuccessResult: (result) => ({
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }),
      });
    },
  });
  return tool;
};
