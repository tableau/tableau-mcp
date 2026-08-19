import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { endpointNotInThisBuild, isRouteMissing } from '../../../desktop/externalApi/toolUtils.js';
import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { resolveSheetRef } from './resolveSheetRef.js';

const paramsSchema = {
  session: sessionParam(),
  sheet: z.string().describe('Worksheet, dashboard, or storyboard name/id to delete.'),
};
const title = 'Delete Sheet';

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
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const refResult = await resolveSheetRef({ session, sheet, extra });
          if (refResult.isErr()) {
            return refResult.error.toErr();
          }
          const { ref, previousName, worksheetCount } = refResult.value;

          if (ref.kind === 'worksheet' && worksheetCount <= 1) {
            return new Ok({
              deleted: false,
              sheet: { id: ref.id, kind: ref.kind, name: previousName },
              message:
                `Refused: "${previousName}" is the only worksheet in the workbook and Tableau ` +
                'workbooks must keep at least one. Create another worksheet first, then delete ' +
                'this one. Nothing was deleted.',
            });
          }

          const executor = await extra.getExecutor(sessionResult.value);
          const result = await executor.deleteSheet(ref, extra.signal);
          if (result.isErr()) {
            if (isRouteMissing(result.error)) {
              return endpointNotInThisBuild('delete-sheet').toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          return new Ok({
            deleted: result.value.status === 'completed',
            sheet: { id: ref.id, kind: ref.kind, name: previousName },
            message:
              result.value.status === 'completed'
                ? `Deleted ${ref.kind} "${previousName}".`
                : `Requested deletion of ${ref.kind} "${previousName}"; Desktop is still applying it.`,
          });
        },
      });
    },
  });

  return deleteSheetTool;
};
