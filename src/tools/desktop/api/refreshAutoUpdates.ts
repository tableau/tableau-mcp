import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { apiVersionAtLeast, ApiVersionFloor } from '../../../desktop/externalApi/apiVersion.js';
import {
  ExecuteCommandError,
  ExecuteCommandWarning,
} from '../../../desktop/externalApi/executorTypes.js';
import { endpointNotInThisBuild } from '../../../desktop/externalApi/toolUtils.js';
import { DashboardRefreshOutcome, SheetKind } from '../../../desktop/externalApi/types.js';
import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import {
  DesktopCommandExecutionError,
  IncompleteOperationError,
} from '../../../errors/mcpToolError.desktop.js';
import { McpToolError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { attachNextAction, prefillNextAction, withNextAction } from '../structuredContent.js';
import { DesktopTool } from '../tool.js';
import { commandOk, commandSuccessResult } from './desktopCommandResult.js';
import { nonCleanRefreshSubject } from './refreshOutcomeSubject.js';
import { resolveSheetRef } from './resolveSheetRef.js';

const paramsSchema = {
  session: sessionParam(),
  sheet: z
    .string()
    .describe('Worksheet, dashboard, or storyboard name/id whose pending updates should run now.'),
  kind: z
    .enum(['worksheet', 'dashboard', 'storyboard'])
    .optional()
    .describe('Restrict the lookup to one kind. Use when a name is shared across kinds.'),
};
const title = 'Refresh Auto Updates';

type SheetBody =
  | { worksheet: { id: string; name: string } }
  | { dashboard: { id: string; name: string } }
  | { storyboard: { id: string; name: string } };
type RefreshToolResult = SheetBody & {
  message: string;
  refreshed?: boolean | DashboardRefreshOutcome['refreshed'];
  outcome?: DashboardRefreshOutcome['outcome'];
  failed?: DashboardRefreshOutcome['failed'];
  warnings?: ExecuteCommandWarning[];
};

const MIN_API_VERSION: Record<SheetKind, ApiVersionFloor> = {
  worksheet: '0.2.13',
  dashboard: '0.2.19',
  storyboard: '0.2.20',
};

const MULTI_TARGET = {
  dashboard: {
    review: 'Review failed dashboard refresh targets',
    failedCode: 'dashboard-refresh-now-failed',
    failedMessage:
      'Desktop failed before refreshing any worksheet in the dashboard; nothing was refreshed.',
    scope: (name: string) => `dashboard "${name}"`,
  },
  storyboard: {
    review: 'Review failed worksheet updates in the current story point',
    failedCode: 'storyboard-refresh-now-failed',
    failedMessage:
      'Desktop failed before refreshing any worksheet in the storyboard; nothing was refreshed.',
    scope: (name: string) => `the current point of storyboard "${name}"`,
  },
} as const;

export const getRefreshAutoUpdatesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const refreshAutoUpdatesTool = new DesktopTool({
    server,
    name: 'refresh-auto-updates',
    minApiVersion: MIN_API_VERSION.worksheet,
    title,
    description:
      'Run pending automatic updates now, without changing the active sheet: for one worksheet, every worksheet in a dashboard, or the current point of a storyboard. ' +
      'Use after batching edits with set-auto-updates-paused. If a dashboard or storyboard worksheet fails, the error result reports a PARTIAL or FAILED outcome per worksheet.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session, sheet, kind }, extra): Promise<CallToolResult> => {
      return await refreshAutoUpdatesTool.logAndExecute<RefreshToolResult>({
        extra,
        args: { session, sheet, kind },
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
          const target = { id: ref.id, name: previousName };
          const executor = await extra.getExecutor(sessionResult.value);
          const apiVersion = executor.desktopApiVersion;
          if (
            apiVersion !== undefined &&
            !apiVersionAtLeast(apiVersion, MIN_API_VERSION[ref.kind])
          ) {
            return endpointNotInThisBuild(`${ref.kind} refresh`).toErr();
          }

          if (ref.kind === 'worksheet') {
            const result = await executor.refreshWorksheetNow(ref.id, extra.signal);
            if (result.isErr()) {
              return refreshError(result.error, 'worksheet');
            }
            const completed = result.value.status === 'completed';
            const subject = completed
              ? `Refreshed auto-updates for worksheet "${previousName}"`
              : `Requested refreshing auto-updates for worksheet "${previousName}"; Desktop is still applying it`;
            return new Ok(
              commandOk(
                { refreshed: completed, worksheet: target, message: `${subject}.` },
                result.value,
                subject,
              ),
            );
          }

          const spec = MULTI_TARGET[ref.kind];
          const sheetBody: SheetBody =
            ref.kind === 'dashboard' ? { dashboard: target } : { storyboard: target };
          const result =
            ref.kind === 'dashboard'
              ? await executor.refreshDashboardNow(ref.id, extra.signal)
              : await executor.refreshStoryboardNow(ref.id, extra.signal);
          if (result.isErr()) {
            if (result.error.type === 'command-failed' && result.error.result !== undefined) {
              return new IncompleteOperationError(
                attachNextAction(
                  { ...sheetBody, ...result.error.result, error: result.error.error },
                  prefillNextAction(spec.review),
                ),
              ).toErr();
            }
            return refreshError(
              result.error,
              ref.kind,
              result.error.type === 'command-failed' && result.error.error?.code === spec.failedCode
                ? spec.failedMessage
                : undefined,
            );
          }

          if (result.value.status !== 'completed') {
            const pending = `Requested refreshing auto-updates for ${ref.kind} "${previousName}"; Desktop is still applying it`;
            return new Ok(
              commandOk(
                { refreshed: false, ...sheetBody, message: `${pending}.` },
                result.value,
                pending,
              ),
            );
          }

          const scope = spec.scope(previousName);
          const nonClean = nonCleanRefreshSubject(scope, result.value.parsedResult);
          const subject = nonClean ?? `Refreshed auto-updates for ${scope}`;
          const body = { ...sheetBody, ...result.value.parsedResult, message: `${subject}.` };
          return new Ok(
            commandOk(
              nonClean === undefined ? body : withNextAction(body, prefillNextAction(spec.review)),
              result.value,
              subject,
            ),
          );
        },
      });
    },
  });

  return refreshAutoUpdatesTool;
};

function refreshError(
  error: ExecuteCommandError,
  kind: SheetKind,
  message?: string,
): Err<McpToolError> {
  if (error.type === 'command-failed' && error.error?.code === 'not-found') {
    return endpointNotInThisBuild(`${kind} refresh`).toErr();
  }
  return new DesktopCommandExecutionError(error, message).toErr();
}
