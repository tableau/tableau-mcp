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
  sheet: z.string().describe('Worksheet or dashboard name/id whose extensions to reload.'),
};
const title = 'Reload Extensions';

export const getReloadExtensionsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const reloadExtensionsTool = new DesktopTool({
    server,
    name: 'reload-extensions',
    minApiVersion: '0.2.25',
    title,
    description:
      'Reload the extension on a worksheet, or every extension on a dashboard. Storyboards are not supported. Succeeds without reloading anything when the sheet hosts no extension.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session, sheet }, extra): Promise<CallToolResult> => {
      return await reloadExtensionsTool.logAndExecute({
        extra,
        args: { session, sheet },
        getSuccessResult: commandSuccessResult,
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
              `"${previousName}" is a storyboard; extensions can only be reloaded on a worksheet or dashboard.`,
            ).toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          const result =
            ref.kind === 'worksheet'
              ? await executor.reloadWorksheetExtension(ref.id, extra.signal)
              : await executor.reloadDashboardExtensions(ref.id, extra.signal);
          if (result.isErr()) {
            if (isRouteMissing(result.error)) {
              return endpointNotInThisBuild('reload-extensions').toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          const subject =
            result.value.status === 'completed'
              ? `Requested reload of extensions for ${ref.kind} "${previousName}"`
              : `Requested reload of extensions for ${ref.kind} "${previousName}"; Desktop is still applying it`;
          return new Ok(
            commandOk(
              {
                sheet: { id: ref.id, kind: ref.kind, name: previousName },
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

  return reloadExtensionsTool;
};
