import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { endpointNotInThisBuild, isRouteMissing } from '../../../desktop/externalApi/toolUtils.js';
import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.desktop.js';
import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { commandOk, commandSuccessResult } from './desktopCommandResult.js';
import { resolveSheetRef } from './resolveSheetRef.js';

const paramsSchema = {
  session: sessionParam(),
  sheet: z.string().describe('Worksheet or dashboard name/id.'),
  kind: z
    .enum(['worksheet', 'dashboard'])
    .optional()
    .describe('Restrict the lookup to one kind. Use when a name is shared across kinds.'),
  isAutoUpdatesPaused: z
    .boolean()
    .describe('true pauses automatic query execution; false resumes it.'),
};
const title = 'Set Auto Updates Paused';

export const getSetAutoUpdatesPausedTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const setAutoUpdatesPausedTool = new DesktopTool({
    server,
    name: 'set-auto-updates-paused',
    minApiVersion: '0.2.5',
    title,
    description:
      'Pause or resume automatic query execution for a worksheet, or for a dashboard and every worksheet it contains. Pause to batch edits before the next refresh. ' +
      'Resuming a dashboard re-enables every worksheet it contains, not only ones paused earlier.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async (
      { session, sheet, kind, isAutoUpdatesPaused },
      extra,
    ): Promise<CallToolResult> => {
      return await setAutoUpdatesPausedTool.logAndExecute({
        extra,
        args: { session, sheet, kind, isAutoUpdatesPaused },
        getSuccessResult: commandSuccessResult,
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const refResult = await resolveSheetRef({ session, sheet, kind, extra });
          if (refResult.isErr()) {
            return refResult.error.toErr();
          }
          const { ref, previousName } = refResult.value;
          const verb = isAutoUpdatesPaused ? 'paused' : 'resumed';

          if (ref.kind === 'storyboard') {
            return new ArgsValidationError(
              `"${previousName}" is a storyboard; auto-updates can only be ${verb} on a worksheet or dashboard.`,
            ).toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          const result = isAutoUpdatesPaused
            ? ref.kind === 'worksheet'
              ? await executor.pauseWorksheetAutoUpdates(ref.id, extra.signal)
              : await executor.pauseDashboardAutoUpdates(ref.id, extra.signal)
            : ref.kind === 'worksheet'
              ? await executor.resumeWorksheetAutoUpdates(ref.id, extra.signal)
              : await executor.resumeDashboardAutoUpdates(ref.id, extra.signal);
          if (result.isErr()) {
            if (isRouteMissing(result.error)) {
              return endpointNotInThisBuild(`${ref.kind} auto-updates`).toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          const completed = result.value.status === 'completed';
          const alsoResumedContainedWorksheets = !isAutoUpdatesPaused && ref.kind === 'dashboard';
          const scope = `${ref.kind} "${previousName}"${alsoResumedContainedWorksheets ? ' and every worksheet it contains' : ''}`;
          const subject = completed
            ? `${isAutoUpdatesPaused ? 'Paused' : 'Resumed'} auto-updates for ${scope}`
            : `Requested ${isAutoUpdatesPaused ? 'pausing' : 'resuming'} auto-updates for ${scope}; Desktop is still applying it`;
          return new Ok(
            commandOk(
              {
                [verb]: completed,
                sheet: { id: ref.id, kind: ref.kind, name: previousName },
                ...(alsoResumedContainedWorksheets ? { alsoResumedContainedWorksheets: true } : {}),
                message: `${subject}.`,
              },
              result.value,
              subject,
            ),
          );
        },
      });
    },
  });

  return setAutoUpdatesPausedTool;
};
