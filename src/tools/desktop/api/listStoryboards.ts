import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
};

const title = 'Listing storyboards';
export const getListStoryboardsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const listStoryboardsTool = new DesktopTool({
    server,
    name: 'list-storyboards',
    title,
    description:
      "Lists the workbook's storyboards, each with its stable id, name, hidden and active-sheet flags, story point count, and index. The index is the 0-based tab position across all sheet types (worksheets, dashboards and storyboards interleaved), not the position in this list; it is null for a hidden sheet and -1 for a sheet with no window.",
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await listStoryboardsTool.logAndExecute({
        extra,
        args: { session },
        callback: async () => {
          const result = await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read(
                'storyboard list',
                async (executor, signal) => await executor.listStoryboards(signal),
              ),
          });
          if (result.isErr()) {
            return result;
          }

          const storyboards = result.value.storyboards ?? [];
          return new Ok({ count: storyboards.length, storyboards });
        },
      });
    },
  });

  return listStoryboardsTool;
};
