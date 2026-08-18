import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { endpointNotInThisBuild, isRouteMissing } from '../../../desktop/externalApi/toolUtils.js';
import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import { ArgsValidationError, DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { resolveSheetRef } from './resolveSheetRef.js';

const paramsSchema = {
  session: sessionParam(),
  sheet: z
    .string()
    .describe('Worksheet or dashboard name/id to resume automatic query execution for.'),
};
const title = 'Resume Auto Updates';

export const getResumeAutoUpdatesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const resumeAutoUpdatesTool = new DesktopTool({
    server,
    name: 'resume-auto-updates',
    minApiVersion: '0.2.5',
    title,
    description:
      'Resume automatic query execution paused with pause-auto-updates. Resuming a dashboard re-enables it and every worksheet it contains, not only ones this paused.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session, sheet }, extra): Promise<CallToolResult> => {
      return await resumeAutoUpdatesTool.logAndExecute({
        extra,
        args: { session, sheet },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const refResult = await resolveSheetRef({ session, sheet, extra });
          if (refResult.isErr()) {
            return refResult.error.toErr();
          }
          const { ref, previousName } = refResult.value;

          if (ref.kind === 'storyboard') {
            return new ArgsValidationError(
              `"${previousName}" is a storyboard; auto-updates can only be resumed on a worksheet or dashboard.`,
            ).toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          const result =
            ref.kind === 'worksheet'
              ? await executor.resumeWorksheetAutoUpdates(ref.id, extra.signal)
              : await executor.resumeDashboardAutoUpdates(ref.id, extra.signal);
          if (result.isErr()) {
            if (isRouteMissing(result.error)) {
              return endpointNotInThisBuild('resume-auto-updates').toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          const completed = result.value.status === 'completed';
          const alsoResumedContainedWorksheets = ref.kind === 'dashboard';
          const scopeSuffix = alsoResumedContainedWorksheets
            ? ' and every worksheet it contains'
            : '';
          return new Ok({
            resumed: completed,
            sheet: { id: ref.id, kind: ref.kind, name: previousName },
            ...(alsoResumedContainedWorksheets ? { alsoResumedContainedWorksheets: true } : {}),
            message: completed
              ? `Resumed auto-updates for ${ref.kind} "${previousName}"${scopeSuffix}.`
              : `Requested resuming auto-updates for ${ref.kind} "${previousName}"${scopeSuffix}; Desktop is still applying it.`,
          });
        },
      });
    },
  });

  return resumeAutoUpdatesTool;
};
