import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { endpointNotInThisBuild, isRouteMissing } from '../../../desktop/externalApi/toolUtils.js';
import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import { withApplyLock } from '../../../desktop/wrappers/applyMutex.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { resolveSheetRef } from './resolveSheetRef.js';

const paramsSchema = {
  session: sessionParam(),
  sheet: z.string().describe('Worksheet, dashboard, or storyboard name/id to rename.'),
  name: z.string().min(1).describe('The new name for the sheet.'),
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
    callback: async ({ session, sheet, name }, extra): Promise<CallToolResult> => {
      return await renameSheetTool.logAndExecute({
        extra,
        args: { session, sheet, name },
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
            const result = await executor.renameSheet(ref, name, extra.signal);
            if (result.isErr()) {
              if (isRouteMissing(result.error)) {
                return endpointNotInThisBuild('rename-sheet').toErr();
              }
              return new DesktopCommandExecutionError(result.error).toErr();
            }

            return new Ok({
              sheet: { id: ref.id, kind: ref.kind, name },
              previousName,
              message:
                result.value.status === 'completed'
                  ? `Renamed ${ref.kind} "${previousName}" to "${name}".`
                  : `Requested rename to "${name}"; Desktop is still applying it.`,
            });
          });
        },
      });
    },
  });

  return renameSheetTool;
};
