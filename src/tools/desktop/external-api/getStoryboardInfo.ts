import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { DesktopMcpServer } from '../../../server.desktop.js';
import { runExternalApiReadTool } from '../externalApiReadHarness.js';
import { DesktopTool } from '../tool.js';
import { resolveItemByNameOrId } from './externalApiToolUtils.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  storyboard: z.string().describe('Storyboard name/id.'),
};
const title = 'Get Storyboard Info';

export const getStoryboardInfoTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getStoryboardInfo = new DesktopTool({
    server,
    name: 'get-storyboard-info',
    title,
    description: 'Read one storyboard by name or id.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, storyboard }, extra): Promise<CallToolResult> => {
      return await getStoryboardInfo.logAndExecute({
        extra,
        args: { session, storyboard },
        callback: async () => {
          return await runExternalApiReadTool({
            toolName: getStoryboardInfo.name,
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              const listResult = await read(
                'storyboard list',
                async (executor, signal) => await executor.listStoryboards(signal),
              );
              if (listResult.isErr()) {
                return listResult;
              }

              const storyboardResult = resolveItemByNameOrId(
                'Storyboard',
                storyboard,
                listResult.value.storyboards ?? [],
              );
              if (storyboardResult.isErr()) {
                return storyboardResult.error.toErr();
              }

              return await read(
                'storyboard metadata',
                async (executor, signal) =>
                  await executor.getStoryboard(storyboardResult.value.id, signal),
              );
            },
          });
        },
      });
    },
  });

  return getStoryboardInfo;
};
