import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
  filePath: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Absolute .twb/.twbx path to save a copy to; omit to save in place at the current path.',
    ),
};
const title = 'Save Workbook';

export const getSaveWorkbookTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const saveWorkbookTool = new DesktopTool({
    server,
    name: 'save-workbook',
    title,
    description:
      'Save the open workbook in place, or pass an absolute .twb/.twbx path to save a copy there. ' +
      'A workbook that has never been saved has no path, so omitting filePath then opens the ' +
      'Save As dialog and blocks until a person responds — pass filePath to save it headlessly.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session, filePath }, extra): Promise<CallToolResult> => {
      return await saveWorkbookTool.logAndExecute({
        extra,
        args: { session, filePath },
        callback: async () => {
          const result = await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read(
                'save-workbook',
                async (executor, signal) => await executor.saveWorkbook(filePath, signal),
              ),
          });
          if (result.isErr()) {
            return result;
          }

          const saved =
            filePath !== undefined ? `Saved a copy to "${filePath}".` : 'Saved the open workbook.';
          return new Ok({
            message:
              result.value.status === 'completed'
                ? saved
                : 'Requested saving the workbook; Desktop is still applying it.',
          });
        },
      });
    },
  });

  return saveWorkbookTool;
};
