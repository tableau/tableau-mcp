import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
  index: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('0-based tab position for the new worksheet; omit to append at the end.'),
};
const title = 'Add Worksheet';

export const getAddWorksheetTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const addWorksheetTool = new DesktopTool({
    server,
    name: 'add-worksheet',
    minApiVersion: '0.2.6',
    title,
    description: 'Add a blank worksheet to the open workbook.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session, index }, extra): Promise<CallToolResult> => {
      return await addWorksheetTool.logAndExecute({
        extra,
        args: { session, index },
        callback: async () => {
          const result = await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read(
                'add-worksheet',
                async (executor, signal) => await executor.addWorksheet(index, signal),
              ),
          });
          if (result.isErr()) {
            return result;
          }

          return new Ok({
            message:
              result.value.status === 'completed'
                ? 'Added a blank worksheet.'
                : 'Requested a new worksheet; Desktop is still applying it.',
          });
        },
      });
    },
  });

  return addWorksheetTool;
};
