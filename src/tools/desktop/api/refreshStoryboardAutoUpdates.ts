import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  ExecuteCommandError,
  ExecuteCommandWarning,
} from '../../../desktop/externalApi/executorTypes.js';
import { endpointNotInThisBuild } from '../../../desktop/externalApi/toolUtils.js';
import { StoryboardRefreshOutcome } from '../../../desktop/externalApi/types.js';
import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import {
  DesktopCommandExecutionError,
  IncompleteOperationError,
} from '../../../errors/mcpToolError.desktop.js';
import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { attachNextAction, prefillNextAction, withNextAction } from '../structuredContent.js';
import { DesktopTool } from '../tool.js';
import { commandOk, commandSuccessResult } from './desktopCommandResult.js';
import { nonCleanRefreshSubject } from './refreshOutcomeSubject.js';
import { resolveSheetRef } from './resolveSheetRef.js';

const paramsSchema = {
  session: sessionParam(),
  storyboard: z
    .string()
    .describe('Storyboard name or stable id whose current point should refresh now.'),
};
const title = 'Refresh Storyboard Auto Updates';
type RefreshStoryboardToolResult = {
  storyboard: { id: string; name: string };
  message: string;
  refreshed?: boolean | StoryboardRefreshOutcome['refreshed'];
  outcome?: StoryboardRefreshOutcome['outcome'];
  failed?: StoryboardRefreshOutcome['failed'];
  warnings?: ExecuteCommandWarning[];
};

export const getRefreshStoryboardAutoUpdatesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const refreshStoryboardAutoUpdatesTool = new DesktopTool({
    server,
    name: 'refresh-storyboard-auto-updates',
    minApiVersion: '0.2.20',
    title,
    description:
      'Run pending automatic updates for the current point of one storyboard now, without changing the active sheet or current story point. If a worksheet fails, the error result reports a PARTIAL or FAILED outcome per worksheet.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session, storyboard }, extra): Promise<CallToolResult> => {
      return await refreshStoryboardAutoUpdatesTool.logAndExecute<RefreshStoryboardToolResult>({
        extra,
        args: { session, storyboard },
        getSuccessResult: commandSuccessResult,
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
            if (result.error.type === 'command-failed' && result.error.result !== undefined) {
              return new IncompleteOperationError(
                attachNextAction(
                  {
                    storyboard: { id: ref.id, name: previousName },
                    ...result.error.result,
                    error: result.error.error,
                  },
                  prefillNextAction('Review failed worksheet updates in the current story point'),
                ),
              ).toErr();
            }
            return new DesktopCommandExecutionError(
              result.error,
              result.error.type === 'command-failed' &&
                result.error.error?.code === 'storyboard-refresh-now-failed'
                ? 'Desktop failed before refreshing any worksheet in the storyboard; nothing was refreshed.'
                : undefined,
            ).toErr();
          }

          if (result.value.status !== 'completed') {
            const pending = `Requested refreshing auto-updates for storyboard "${previousName}"; Desktop is still applying it`;
            return new Ok(
              commandOk(
                {
                  refreshed: false,
                  storyboard: { id: ref.id, name: previousName },
                  message: `${pending}.`,
                },
                result.value,
                pending,
              ),
            );
          }

          const nonClean = nonCleanRefreshSubject(
            `the current point of storyboard "${previousName}"`,
            result.value.parsedResult,
          );
          const subject =
            nonClean ??
            `Refreshed auto-updates for the current point of storyboard "${previousName}"`;
          const body = {
            storyboard: { id: ref.id, name: previousName },
            ...result.value.parsedResult,
            message: `${subject}.`,
          };
          return new Ok(
            commandOk(
              nonClean === undefined
                ? body
                : withNextAction(
                    body,
                    prefillNextAction('Review failed worksheet updates in the current story point'),
                  ),
              result.value,
              subject,
            ),
          );
        },
      });
    },
  });

  return refreshStoryboardAutoUpdatesTool;
};

function isRefreshRouteMissing(error: ExecuteCommandError): boolean {
  return error.type === 'command-failed' && error.error?.code === 'not-found';
}
