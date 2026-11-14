import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { apiVersionAtLeast, ApiVersionFloor } from '../../../desktop/externalApi/apiVersion.js';
import {
  ExecuteCommandError,
  ExecuteCommandWarning,
} from '../../../desktop/externalApi/executorTypes.js';
import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
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
import { resolveSheetIdOfKind } from './resolveSheetRef.js';

const paramsSchema = {
  session: sessionParam(),
  sheetId: z
    .string()
    .min(1)
    .describe(
      'Id of the sheet whose pending updates should run now. A unique sheet name also works.',
    ),
  kind: z
    .enum(['worksheet', 'dashboard', 'storyboard'])
    .describe('Which kind of sheet sheetId is.'),
};
const title = 'Refresh Auto Updates';

type RefreshToolResult = {
  sheet: { id: string; kind: SheetKind };
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
    scope: (id: string) => `dashboard "${id}"`,
  },
  storyboard: {
    review: 'Review failed worksheet updates in the current story point',
    failedCode: 'storyboard-refresh-now-failed',
    failedMessage:
      'Desktop failed before refreshing any worksheet in the storyboard; nothing was refreshed.',
    scope: (id: string) => `the current point of storyboard "${id}"`,
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
    callback: async ({ session, sheetId, kind }, extra): Promise<CallToolResult> => {
      return await refreshAutoUpdatesTool.logAndExecute<RefreshToolResult>({
        extra,
        args: { session, sheetId, kind },
        getSuccessResult: commandSuccessResult,
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          const apiVersion = executor.desktopApiVersion;
          if (apiVersion !== undefined && !apiVersionAtLeast(apiVersion, MIN_API_VERSION[kind])) {
            return endpointNotInThisBuild(`${kind} refresh`).toErr();
          }

          const dispatched = await refreshByIdThenName(executor, kind, sheetId, extra.signal);
          if (dispatched.isErr()) {
            return dispatched;
          }
          const { id } = dispatched.value;
          const sheet = { id, kind };

          if (dispatched.value.kind === 'worksheet') {
            const { result } = dispatched.value;
            if (result.isErr()) {
              return refreshError(result.error, 'worksheet');
            }
            const completed = result.value.status === 'completed';
            const subject = completed
              ? `Refreshed auto-updates for worksheet "${id}"`
              : `Requested refreshing auto-updates for worksheet "${id}"; Desktop is still applying it`;
            return new Ok(
              commandOk(
                { refreshed: completed, sheet, message: `${subject}.` },
                result.value,
                subject,
              ),
            );
          }

          const spec = MULTI_TARGET[dispatched.value.kind];
          const { result } = dispatched.value;
          if (result.isErr()) {
            if (result.error.type === 'command-failed' && result.error.result !== undefined) {
              return new IncompleteOperationError(
                attachNextAction(
                  { sheet, ...result.error.result, error: result.error.error },
                  prefillNextAction(spec.review),
                ),
              ).toErr();
            }
            return refreshError(
              result.error,
              kind,
              result.error.type === 'command-failed' && result.error.error?.code === spec.failedCode
                ? spec.failedMessage
                : undefined,
            );
          }

          if (result.value.status !== 'completed') {
            const pending = `Requested refreshing auto-updates for ${kind} "${id}"; Desktop is still applying it`;
            return new Ok(
              commandOk({ refreshed: false, sheet, message: `${pending}.` }, result.value, pending),
            );
          }

          const scope = spec.scope(id);
          const nonClean = nonCleanRefreshSubject(scope, result.value.parsedResult);
          const subject = nonClean ?? `Refreshed auto-updates for ${scope}`;
          const body = { sheet, ...result.value.parsedResult, message: `${subject}.` };
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

type Dispatched =
  | {
      kind: 'worksheet';
      result: Awaited<ReturnType<ExternalApiToolExecutor['refreshWorksheetNow']>>;
    }
  | {
      kind: 'dashboard' | 'storyboard';
      result: Awaited<ReturnType<ExternalApiToolExecutor['refreshDashboardNow']>>;
    };

async function refreshByIdThenName(
  executor: ExternalApiToolExecutor,
  kind: SheetKind,
  sheet: string,
  signal: AbortSignal,
): Promise<Result<Dispatched & { id: string }, McpToolError>> {
  const byId = await dispatchRefresh(executor, kind, sheet, signal);
  if (
    !byId.result.isErr() ||
    byId.result.error.type !== 'command-failed' ||
    byId.result.error.error?.code !== 'sheet-not-found'
  ) {
    return new Ok({ ...byId, id: sheet });
  }
  const resolved = await resolveSheetIdOfKind({ executor, kind, sheet, signal });
  if (resolved.isErr()) {
    return resolved;
  }
  if (resolved.value === sheet) {
    return new Ok({ ...byId, id: sheet });
  }
  return new Ok({
    ...(await dispatchRefresh(executor, kind, resolved.value, signal)),
    id: resolved.value,
  });
}

async function dispatchRefresh(
  executor: ExternalApiToolExecutor,
  kind: SheetKind,
  id: string,
  signal: AbortSignal,
): Promise<Dispatched> {
  switch (kind) {
    case 'worksheet':
      return { kind, result: await executor.refreshWorksheetNow(id, signal) };
    case 'dashboard':
      return { kind, result: await executor.refreshDashboardNow(id, signal) };
    case 'storyboard':
      return { kind, result: await executor.refreshStoryboardNow(id, signal) };
  }
}
