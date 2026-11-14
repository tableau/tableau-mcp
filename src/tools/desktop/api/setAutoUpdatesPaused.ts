import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { endpointNotInThisBuild, isRouteMissing } from '../../../desktop/externalApi/toolUtils.js';
import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.desktop.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { commandOk, commandSuccessResult } from './desktopCommandResult.js';
import { resolveSheetIdOfKind } from './resolveSheetRef.js';

const paramsSchema = {
  session: sessionParam(),
  sheetId: z
    .string()
    .min(1)
    .describe('Id of the worksheet or dashboard. A unique sheet name also works.'),
  kind: z.enum(['worksheet', 'dashboard']).describe('Which kind of sheet sheetId is.'),
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
      { session, sheetId, kind, isAutoUpdatesPaused },
      extra,
    ): Promise<CallToolResult> => {
      return await setAutoUpdatesPausedTool.logAndExecute({
        extra,
        args: { session, sheetId, kind, isAutoUpdatesPaused },
        getSuccessResult: commandSuccessResult,
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          const idResult = await resolveSheetIdOfKind({
            executor,
            kind,
            sheet: sheetId,
            signal: extra.signal,
          });
          if (idResult.isErr()) {
            return idResult;
          }
          const id = idResult.value;
          const result = isAutoUpdatesPaused
            ? kind === 'worksheet'
              ? await executor.pauseWorksheetAutoUpdates(id, extra.signal)
              : await executor.pauseDashboardAutoUpdates(id, extra.signal)
            : kind === 'worksheet'
              ? await executor.resumeWorksheetAutoUpdates(id, extra.signal)
              : await executor.resumeDashboardAutoUpdates(id, extra.signal);
          if (result.isErr()) {
            if (isRouteMissing(result.error)) {
              return endpointNotInThisBuild(`${kind} auto-updates`).toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          const completed = result.value.status === 'completed';
          const alsoResumedContainedWorksheets = !isAutoUpdatesPaused && kind === 'dashboard';
          const scope = `${kind} "${id}"${alsoResumedContainedWorksheets ? ' and every worksheet it contains' : ''}`;
          const subject = completed
            ? `${isAutoUpdatesPaused ? 'Paused' : 'Resumed'} auto-updates for ${scope}`
            : `Requested ${isAutoUpdatesPaused ? 'pausing' : 'resuming'} auto-updates for ${scope}; Desktop is still applying it`;
          return new Ok(
            commandOk(
              {
                [isAutoUpdatesPaused ? 'paused' : 'resumed']: completed,
                sheet: { id, kind },
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
