import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { searchWorkbookFields } from '../../../../desktop/metadata/index.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import { DesktopCommandExecutionError } from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { DesktopTool } from '../../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  query: z.string().trim().min(1).describe('Case-insensitive text to find in workbook fields.'),
  limit: z.number().int().min(1).max(100).optional().describe('Maximum matches; defaults to 20.'),
};

const title = 'Searching workbook fields';

export const getSearchWorkbookFieldsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const searchWorkbookFieldsTool = new DesktopTool({
    server,
    name: 'search-workbook-fields',
    title,
    description:
      'Search fields and calculations in the current open workbook and report worksheet shelf and mark placements; does not search published content.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, query, limit }, extra): Promise<CallToolResult> => {
      return await searchWorkbookFieldsTool.logAndExecute({
        extra,
        args: { session, query, limit },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) return sessionResult.error.toErr();

          const executor = await extra.getExecutor(sessionResult.value);
          const workbookResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (workbookResult.isErr()) {
            return new DesktopCommandExecutionError(workbookResult.error).toErr();
          }

          return Ok(searchWorkbookFields(workbookResult.value, query, limit ?? 20));
        },
      });
    },
  });

  return searchWorkbookFieldsTool;
};
