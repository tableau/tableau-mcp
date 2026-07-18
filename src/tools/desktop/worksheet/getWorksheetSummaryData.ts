import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getWorksheetSummaryData } from '../../../desktop/commands/workbook/getWorksheetSummaryData.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import {
  DesktopCommandExecutionError,
  UnknownError,
  WorksheetNotFoundError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  worksheetName: z.string().describe('Existing worksheet name (see list-worksheets).'),
  maxRows: z.number().int().positive().optional().describe('Max rows to return.'),
};

const title = 'Get Worksheet Summary Data';
export const getGetWorksheetSummaryDataTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'get-worksheet-summary-data',
    title,
    description: "Get a worksheet's summary data (columns and rows).",
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, worksheetName, maxRows }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, worksheetName, maxRows },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);
          const result = await getWorksheetSummaryData({
            worksheetName,
            maxRows,
            executor,
            signal: extra.signal,
          });

          if (result.isErr()) {
            const { type, error } = result.error;
            switch (type) {
              case 'get-worksheet-summary-data-error':
                return new WorksheetNotFoundError(error.message).toErr();
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              default: {
                const _: never = type;
                return new UnknownError(error).toErr();
              }
            }
          }

          return new Ok(result.value);
        },
      });
    },
  });

  return tool;
};
