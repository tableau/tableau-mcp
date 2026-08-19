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
    .describe('Worksheet or dashboard name/id to pause automatic query execution for.'),
};
const title = 'Pause Auto Updates';

export const getPauseAutoUpdatesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const pauseAutoUpdatesTool = new DesktopTool({
    server,
    name: 'pause-auto-updates',
    minApiVersion: '0.2.5',
    title,
    description:
      'Pause automatic query execution for a worksheet or dashboard to batch edits before the next refresh. Resume with resume-auto-updates.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session, sheet }, extra): Promise<CallToolResult> => {
      return await pauseAutoUpdatesTool.logAndExecute({
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
              `"${previousName}" is a storyboard; auto-updates can only be paused on a worksheet or dashboard.`,
            ).toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          const result =
            ref.kind === 'worksheet'
              ? await executor.pauseWorksheetAutoUpdates(ref.id, extra.signal)
              : await executor.pauseDashboardAutoUpdates(ref.id, extra.signal);
          if (result.isErr()) {
            if (isRouteMissing(result.error)) {
              return endpointNotInThisBuild('pause-auto-updates').toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          return new Ok({
            paused: result.value.status === 'completed',
            sheet: { id: ref.id, kind: ref.kind, name: previousName },
            message:
              result.value.status === 'completed'
                ? `Paused auto-updates for ${ref.kind} "${previousName}".`
                : `Requested pausing auto-updates for ${ref.kind} "${previousName}"; Desktop is still applying it.`,
          });
        },
      });
    },
  });

  return pauseAutoUpdatesTool;
};
