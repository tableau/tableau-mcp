import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { searchKnowledgeWithFallback } from '../../../desktop/knowledge/index.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  query: z.string().describe('Task or topic (e.g. "top 10 by category")'),
  limit: z.number().int().positive().optional().describe('Max results (default 5)'),
};

const toolTitle = 'Search Knowledge';
export const getSearchKnowledgeTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'search-knowledge',
    title: toolTitle,
    description:
      'Find relevant expertise for a task (top N by uri+title). Best queried with short concept phrases (e.g. "symbol map latitude longitude"), not tool names. Use THIS to discover knowledge, not list.',
    paramsSchema,
    annotations: {
      title: toolTitle,
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
          return new Ok(searchKnowledgeWithFallback(query, limit));
        },
        getSuccessResult: (result) => ({
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }),
      });
    },
  });
  return tool;
};
