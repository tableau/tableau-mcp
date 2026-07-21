import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { DesktopMcpServer } from '../../../server.desktop.js';
import { runExternalApiReadTool } from '../externalApiReadHarness.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
};
const title = 'List Storyboards';

export const getListStoryboardsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const listStoryboards = new DesktopTool({
    server,
    name: 'list-storyboards',
    title,
    description: 'List storyboards.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await listStoryboards.logAndExecute({
        extra,
        args: { session },
        callback: async () => {
          const result = await runExternalApiReadTool({
            toolName: listStoryboards.name,
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

          return new Ok({ storyboards: result.value.storyboards ?? [] });
        },
      });
    },
  });

  return listStoryboards;
};
