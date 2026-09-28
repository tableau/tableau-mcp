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
  storyboard: z
    .string()
    .describe('Storyboard name or stable id whose current point should refresh now.'),
};
const title = 'Refresh Storyboard Auto Updates';

export const getRefreshStoryboardAutoUpdatesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const refreshStoryboardAutoUpdatesTool = new DesktopTool({
    server,
    name: 'refresh-storyboard-auto-updates',
    minApiVersion: '0.2.20',
    title,
    description: 'Run pending automatic updates for the current point of one storyboard now.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session, storyboard }, extra): Promise<CallToolResult> => {
      return await refreshStoryboardAutoUpdatesTool.logAndExecute({
        extra,
        args: { session, storyboard },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const refResult = await resolveSheetRef({ session, sheet: storyboard, extra });
          if (refResult.isErr()) {
            return refResult.error.toErr();
          }
          const { ref, previousName } = refResult.value;

          if (ref.kind !== 'storyboard') {
            return new ArgsValidationError(
              `"${previousName}" is a ${ref.kind}; auto-updates can only be refreshed on a storyboard.`,
            ).toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          const result = await executor.refreshStoryboardNow(ref.id, extra.signal);
          if (result.isErr()) {
            if (isRefreshRouteMissing(result.error)) {
              return endpointNotInThisBuild('refresh-storyboard-auto-updates').toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          const completed = result.value.status === 'completed';
          return new Ok({
            refreshed: completed,
            storyboard: { id: ref.id, name: previousName },
            message: completed
              ? `Refreshed auto-updates for storyboard "${previousName}".`
              : `Requested refreshing auto-updates for storyboard "${previousName}"; Desktop is still applying it.`,
          });
        },
      });
    },
  });

  return refreshStoryboardAutoUpdatesTool;
};

function isRefreshRouteMissing(error: ExecuteCommandError): boolean {
  return error.type === 'command-failed' && error.error?.code === 'not-found';
}
