import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { resolveItemByNameOrId } from '../../../../desktop/externalApi/toolUtils.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { DesktopCommandExecutionError } from '../../../../errors/mcpToolError.desktop.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { sessionParam } from '../../params.js';
import { DesktopTool } from '../../tool.js';
import { FormatOptions, readFormatOptions } from './formatWorksheets.js';

const paramsSchema = {
  session: sessionParam(),
  worksheets: z.array(z.string().trim().min(1).max(255)).min(1).max(12),
};

type WorksheetFormatOptions = { worksheet: string } & FormatOptions;

export const getGetFormatOptionsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'get-format-options',
    title: 'Get Format Options',
    description:
      'List the formatting format-worksheets can set on each worksheet, with current values.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, worksheets }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<{ worksheets: WorksheetFormatOptions[] }>({
        extra,
        args: { session, worksheets },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) return sessionResult.error.toErr();
          const executor = await extra.getExecutor(sessionResult.value);
          const listed = await executor.listWorksheets(extra.signal);
          if (listed.isErr()) return new DesktopCommandExecutionError(listed.error).toErr();

          const results: WorksheetFormatOptions[] = [];
          for (const name of worksheets) {
            const item = resolveItemByNameOrId('Worksheet', name, listed.value.worksheets ?? []);
            if (item.isErr()) return item.error.toErr();
            const document = await executor.getWorksheetDocument(item.value.id, extra.signal);
            if (document.isErr()) return new DesktopCommandExecutionError(document.error).toErr();
            results.push({
              worksheet: item.value.name,
              ...readFormatOptions(document.value.xml),
            });
          }
          return new Ok({ worksheets: results });
        },
      });
    },
  });
  return tool;
};
