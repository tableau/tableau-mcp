import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { withApplyLock } from '../../../desktop/wrappers/applyMutex.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { commandOk, commandSuccessResult } from './desktopCommandResult.js';

const paramsSchema = {
  session: sessionParam(),
  action: z
    .enum(['undo', 'redo'])
    .describe(
      'undo reverses the most recent change; redo reapplies the change most recently undone.',
    ),
};
const title = 'Undo or Redo';

const SUBJECTS = {
  undo: {
    completed: 'Undid the last change to the open workbook',
    pending: 'Requested undo; Desktop is still applying it',
  },
  redo: {
    completed: 'Reapplied the most recently undone change to the open workbook',
    pending: 'Requested redo; Desktop is still applying it',
  },
} as const;

export const getUndoRedoWorkbookTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const undoRedoWorkbookTool = new DesktopTool({
    server,
    name: 'undo-redo-workbook',
    title,
    description:
      'Undo (Edit > Undo) reverses the most recent change to the open workbook; redo (Edit > Redo) reapplies the change most recently undone.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session, action }, extra): Promise<CallToolResult> => {
      return await undoRedoWorkbookTool.logAndExecute({
        extra,
        args: { session, action },
        getSuccessResult: commandSuccessResult,
        callback: async () => {
          const result = await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read(
                action,
                async (executor, signal) =>
                  await withApplyLock(async () =>
                    action === 'undo' ? await executor.undo(signal) : await executor.redo(signal),
                  ),
              ),
          });
          if (result.isErr()) {
            return result;
          }

          const subject =
            result.value.status === 'completed'
              ? SUBJECTS[action].completed
              : SUBJECTS[action].pending;
          return new Ok(commandOk({ message: `${subject}.` }, result.value, subject));
        },
      });
    },
  });

  return undoRedoWorkbookTool;
};
