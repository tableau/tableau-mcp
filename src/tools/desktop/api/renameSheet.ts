import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { endpointNotInThisBuild, isRouteMissing } from '../../../desktop/externalApi/toolUtils.js';
import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import { withApplyLock } from '../../../desktop/wrappers/applyMutex.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.desktop.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { artifactNameParam, sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { commandOk, commandSuccessResult } from './desktopCommandResult.js';
import { resolveSheetRef } from './resolveSheetRef.js';

const paramsSchema = {
  session: sessionParam(),
  sheet: artifactNameParam('sheet'),
  newName: z.string().trim().min(1).describe('The new name for the sheet.'),
};
const title = 'Rename Sheet';

export const getRenameSheetTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const renameSheetTool = new DesktopTool({
    server,
    name: 'rename-sheet',
    title,
    description: 'Rename a worksheet, dashboard, or storyboard by name or id.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session, sheet, newName }, extra): Promise<CallToolResult> => {
      return await renameSheetTool.logAndExecute({
        extra,
        args: { session, sheet, newName },
        getSuccessResult: commandSuccessResult,
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          return await withApplyLock(async () => {
            const refResult = await resolveSheetRef({ session, sheet, extra });
            if (refResult.isErr()) {
              return refResult.error.toErr();
            }
            const { ref, previousName } = refResult.value;

            const executor = await extra.getExecutor(sessionResult.value);
            const result = await executor.renameSheet(ref, newName, extra.signal);
            if (result.isErr()) {
              if (isRouteMissing(result.error)) {
                return endpointNotInThisBuild('rename-sheet').toErr();
              }
              return new DesktopCommandExecutionError(result.error).toErr();
            }

            const subject =
              result.value.status !== 'completed'
                ? `Requested rename to "${newName}"; Desktop is still applying it`
                : newName === previousName
                  ? `The ${ref.kind} is already named "${newName}"; nothing was renamed`
                  : `Renamed ${ref.kind} "${previousName}" to "${newName}"`;
            return new Ok(
              commandOk(
                {
                  sheet: { id: ref.id, kind: ref.kind, name: newName },
                  previousName,
                  message: `${subject}.`,
                },
                result.value,
                subject,
              ),
            );
          });
        },
      });
    },
  });

  return renameSheetTool;
};
