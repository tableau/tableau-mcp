import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { DesktopMcpServer } from '../../../server.desktop.js';
import { runExternalApiReadTool } from '../externalApiReadHarness.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
};

const title = 'Get Workbook Inventory';
export const getWorkbookInventoryTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getWorkbookInventory = new DesktopTool({
    server,
    name: 'get-workbook-inventory',
    title,
    description:
      'Orienting read: title, unsaved changes, and worksheet/dashboard/storyboard inventory. Not needed before bind-template; use for exploration or non-template authoring.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await getWorkbookInventory.logAndExecute({
        extra,
        args: { session },
        callback: async () => {
          const result = await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read(
                'workbook inventory',
                async (executor, signal) => await executor.getWorkbook(signal),
              ),
          });
          if (result.isErr()) {
            return result;
          }

          return new Ok({
            title: result.value.title,
            ...(result.value.location !== undefined ? { location: result.value.location } : {}),
            unsavedChanges: result.value.unsavedChanges,
            worksheets: result.value.worksheets ?? [],
            dashboards: result.value.dashboards ?? [],
            storyboards: result.value.storyboards ?? [],
          });
        },
      });
    },
  });

  return getWorkbookInventory;
};
