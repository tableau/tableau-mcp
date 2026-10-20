import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { endpointNotInThisBuild, isRouteMissing } from '../../../desktop/externalApi/toolUtils.js';
import { SheetKind } from '../../../desktop/externalApi/types.js';
import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import { withApplyLock } from '../../../desktop/wrappers/applyMutex.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.desktop.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { commandOk, commandSuccessResult } from './desktopCommandResult.js';
import { resolveSheetRef } from './resolveSheetRef.js';

const paramsSchema = {
  session: sessionParam(),
  sheet: z.string().describe('Worksheet, dashboard, or storyboard name/id to delete.'),
};
const title = 'Delete Sheet';

type DeleteSheetResult = {
  deleted: boolean;
  sheet: { id: string; kind: SheetKind; name: string };
  message: string;
};

export const getDeleteSheetTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const deleteSheetTool = new DesktopTool({
    server,
    name: 'delete-sheet',
    title,
    description:
      'Delete a worksheet, dashboard, or storyboard by name or id. Deletes the sheet and its window.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session, sheet }, extra): Promise<CallToolResult> => {
      return await deleteSheetTool.logAndExecute({
        extra,
        args: { session, sheet },
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
            const { ref, previousName, worksheetCount } = refResult.value;

            if (ref.kind === 'worksheet' && worksheetCount <= 1) {
              const refused: DeleteSheetResult = {
                deleted: false,
                sheet: { id: ref.id, kind: ref.kind, name: previousName },
                message:
                  `Refused: "${previousName}" is the only worksheet in the workbook and Tableau ` +
                  'workbooks must keep at least one. Create another worksheet first, then delete ' +
                  'this one. Nothing was deleted.',
              };
              return new Ok(refused);
            }

            const executor = await extra.getExecutor(sessionResult.value);
            const result = await executor.deleteSheet(ref, extra.signal);
            if (result.isErr()) {
              if (isRouteMissing(result.error)) {
                return endpointNotInThisBuild('delete-sheet').toErr();
              }
              return new DesktopCommandExecutionError(result.error).toErr();
            }

            const subject =
              result.value.status === 'completed'
                ? `Deleted ${ref.kind} "${previousName}"`
                : `Requested deletion of ${ref.kind} "${previousName}"; Desktop is still applying it`;
            return new Ok(
              commandOk(
                {
                  deleted: result.value.status === 'completed',
                  sheet: { id: ref.id, kind: ref.kind, name: previousName },
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

  return deleteSheetTool;
};
