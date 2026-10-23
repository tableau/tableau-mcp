import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { resolveSheetRef } from './resolveSheetRef.js';

const paramsSchema = {
  session: sessionParam(),
  sheet: z.string().describe('Worksheet, dashboard, or storyboard name/id.'),
  kind: z
    .enum(['worksheet', 'dashboard', 'storyboard'])
    .optional()
    .describe('Restrict the lookup to one kind. Use when a name is shared across kinds.'),
};

const title = 'Get Sheet Info';

export const getGetSheetInfoTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const getSheetInfoTool = new DesktopTool({
    server,
    name: 'get-sheet-info',
    title,
    description:
      'Read one worksheet, dashboard, or storyboard by name or id: its state and index, plus the datasources of a worksheet, the sheets in a dashboard, or the story point count of a storyboard.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, sheet, kind }, extra): Promise<CallToolResult> => {
      return await getSheetInfoTool.logAndExecute({
        extra,
        args: { session, sheet, kind },
        callback: async () => {
          const refResult = await resolveSheetRef({ session, sheet, kind, extra });
          if (refResult.isErr()) {
            return refResult.error.toErr();
          }
          const { ref } = refResult.value;

          return await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              const item =
                ref.kind === 'worksheet'
                  ? await read(
                      'worksheet',
                      async (executor, signal) => await executor.getWorksheet(ref.id, signal),
                    )
                  : ref.kind === 'dashboard'
                    ? await read(
                        'dashboard',
                        async (executor, signal) => await executor.getDashboard(ref.id, signal),
                      )
                    : await read(
                        'storyboard',
                        async (executor, signal) => await executor.getStoryboard(ref.id, signal),
                      );
              if (item.isErr()) {
                return item;
              }
              return new Ok({ kind: ref.kind, ...item.value });
            },
          });
        },
      });
    },
  });

  return getSheetInfoTool;
};
