import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.desktop.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { artifactNameParam, sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
  worksheet: artifactNameParam('worksheet', { min: 1 }).optional(),
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
    callback: async ({ session, worksheet }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, worksheet },
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
              if (worksheet === undefined) {
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
                worksheet,
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
