import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import type { ExecuteCommandError } from '../../../../desktop/externalApi/executorTypes.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { DesktopCommandExecutionError, McpToolError } from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { sessionParam } from '../../params.js';
import { jsonToolResult } from '../../structuredContent.js';
import { DesktopTool } from '../../tool.js';

const paramsSchema = {
  session: sessionParam({ max: 64 }),
};

type ExportCustomThemeResult = {
  readonly started: true;
  readonly requiresUserAction: boolean;
  readonly action: string;
};

export const getExportCustomThemeTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'export-custom-theme',
    title: 'Export Custom Theme',
    description: "Open Tableau's native Custom Theme export dialog.",
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<ExportCustomThemeResult>({
        extra,
        args: { session },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) return sessionResult.error.toErr();

          const executor = await extra.getExecutor(sessionResult.value);
          const expectedInstanceId = executor.desktopInstanceId;
          if (!expectedInstanceId) {
            return new McpToolError({
              type: 'desktop-instance-missing',
              message:
                'The Desktop executor did not report an instance ID; export was not started.',
              statusCode: 409,
            }).toErr();
          }

          const result = await executor.executeCommand({
            namespace: 'tabui',
            command: 'export-theme',
            expectedInstanceId,
            signal: extra.signal,
          });
          if (result.isErr()) {
            if (isExportThemeDialog(result.error)) {
              return new Ok({
                started: true,
                requiresUserAction: true,
                action: 'Save the Custom Theme JSON in Tableau, then attach it in Studio.',
              });
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          return new Ok({
            started: true,
            requiresUserAction: false,
            action: 'Tableau completed the Custom Theme export command.',
          });
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
    },
  });
  return tool;
};

function isExportThemeDialog(error: ExecuteCommandError): boolean {
  return (
    error.type === 'command-failed' &&
    error.error?.code === 'awaiting-user' &&
    error.error.message?.includes('Export Custom Theme') === true
  );
}
