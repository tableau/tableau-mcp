import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
};
const title = 'Undo';

export const getUndoWorkbookTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const undoWorkbookTool = new DesktopTool({
    server,
    name: 'undo-workbook',
    title,
    description: 'Reverse the most recent change to the open workbook (Edit > Undo).',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await undoWorkbookTool.logAndExecute({
        extra,
        args: { session },
        callback: async () => {
          const result = await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read('undo', async (executor, signal) => await executor.undo(signal)),
          });
          if (result.isErr()) {
            return result;
          }

          return new Ok({
            message:
              result.value.status === 'completed'
                ? 'Undid the last change to the open workbook.'
                : 'Requested undo; Desktop is still applying it.',
          });
        },
      });
    },
  });

  return undoWorkbookTool;
};
