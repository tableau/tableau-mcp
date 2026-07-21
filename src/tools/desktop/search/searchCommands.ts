import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { searchCommandsByKeywords } from '../../../desktop/search/searchLibrary.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  keywords: z
    .union([z.array(z.string()), z.string()])
    .transform((v) => (typeof v === 'string' ? v.split(/[,\s]+/).filter(Boolean) : v))
    .describe('Keywords; string splits on whitespace/commas.'),
};

const title = 'Search Tableau Commands Reference';
export const getSearchCommandsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'search-commands',
    title,
    description: 'Search the Tableau Desktop commands reference for invocable commands.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ keywords }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { keywords },
        callback: async () => {
          const result = searchCommandsByKeywords(keywords);
          return new Ok(result);
        },
      });
    },
  });

  return tool;
};
