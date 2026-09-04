import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ExecuteCommandError } from '../../../desktop/externalApi/executorTypes.js';
import { endpointNotInThisBuild } from '../../../desktop/externalApi/toolUtils.js';
import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import { ArgsValidationError, DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { resolveSheetRef } from './resolveSheetRef.js';

const paramsSchema = {
  session: sessionParam(),
  worksheet: z
    .string()
    .describe('Worksheet name or stable id whose pending automatic updates should run now.'),
};
const title = 'Refresh Auto Updates';

export const getRefreshAutoUpdatesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const refreshAutoUpdatesTool = new DesktopTool({
    server,
    name: 'refresh-auto-updates',
    minApiVersion: '0.2.11',
    title,
    description:
      'Run pending automatic updates for one worksheet now. Use after batching edits with pause-auto-updates.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session, worksheet }, extra): Promise<CallToolResult> => {
      return await refreshAutoUpdatesTool.logAndExecute({
        extra,
        args: { session, worksheet },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const refResult = await resolveSheetRef({ session, sheet: worksheet, extra });
          if (refResult.isErr()) {
            return refResult.error.toErr();
          }
          const { ref, previousName } = refResult.value;

          if (ref.kind !== 'worksheet') {
            return new ArgsValidationError(
              `"${previousName}" is a ${ref.kind}; auto-updates can only be refreshed on a worksheet.`,
            ).toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          const result = await executor.refreshWorksheetNow(ref.id, extra.signal);
          if (result.isErr()) {
            if (isRefreshRouteMissing(result.error)) {
              return endpointNotInThisBuild('refresh-auto-updates').toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          const completed = result.value.status === 'completed';
          return new Ok({
            refreshed: completed,
            worksheet: { id: ref.id, name: previousName },
            message: completed
              ? `Refreshed auto-updates for worksheet "${previousName}".`
              : `Requested refreshing auto-updates for worksheet "${previousName}"; Desktop is still applying it.`,
          });
        },
      });
    },
  });

  return refreshAutoUpdatesTool;
};

function isRefreshRouteMissing(error: ExecuteCommandError): boolean {
  return error.type === 'command-failed' && error.error?.code === 'not-found';
}
