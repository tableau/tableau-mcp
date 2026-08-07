import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
};
const title = 'Redo';

export const getRedoWorkbookTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const redoWorkbookTool = new DesktopTool({
    server,
    name: 'redo-workbook',
    title,
    description: 'Reapply the change most recently undone on the open workbook (Edit > Redo).',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await redoWorkbookTool.logAndExecute({
        extra,
        args: { session },
        callback: async () => {
          const result = await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read('redo', async (executor, signal) => await executor.redo(signal)),
          });
          if (result.isErr()) {
            return result;
          }

          return new Ok({
            message:
              result.value.status === 'completed'
                ? 'Reapplied the most recently undone change to the open workbook.'
                : 'Requested redo; Desktop is still applying it.',
          });
        },
      });
    },
  });

  return redoWorkbookTool;
};
