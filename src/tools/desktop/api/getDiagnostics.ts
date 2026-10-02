import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
  worksheetName: z
    .string()
    .min(1)
    .optional()
    .describe('Worksheet name or stable id; omit for diagnostics for the entire workbook.'),
};

export const getDiagnosticsTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'get-diagnostics',
    minApiVersion: '0.2.16',
    title: 'Get Workbook Diagnostics',
    description:
      'Inspect the existing workbook before editing. Use diagnostics returned by supported workbook and worksheet document edits instead of a second read for the same result. Static diagnostics do not verify query execution or rendering.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, worksheetName }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, worksheetName },
        callback: async () =>
          await runExternalApiReadTool({
            session,
            extra,
            callback: async (executor, signal, read) => {
              const expectedInstanceId = executor.desktopInstanceId;
              if (!expectedInstanceId) {
                return new DesktopCommandExecutionError({
                  type: 'unknown',
                  error: 'Workbook diagnostics could not pin the current Desktop instance.',
                }).toErr();
              }
              if (worksheetName === undefined) {
                return await read(
                  'workbook diagnostics',
                  async (activeExecutor, activeSignal) =>
                    await activeExecutor.getWorkbookDiagnostics(activeSignal, expectedInstanceId),
                );
              }

              const worksheets = await read(
                'worksheet list',
                async (activeExecutor, activeSignal) =>
                  await activeExecutor.listWorksheets(activeSignal),
              );
              if (worksheets.isErr()) return worksheets;
              const target = resolveItemByNameOrId(
                'Worksheet',
                worksheetName,
                worksheets.value.worksheets ?? [],
              );
              if (target.isErr()) return target.error.toErr();

              return await read(
                'worksheet diagnostics',
                async (activeExecutor, activeSignal) =>
                  await activeExecutor.getWorksheetDiagnostics(
                    target.value.id,
                    activeSignal,
                    expectedInstanceId,
                  ),
              );
            },
          }),
      });
    },
  });

  return tool;
};
