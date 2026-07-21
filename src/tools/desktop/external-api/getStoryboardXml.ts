import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { DesktopMcpServer } from '../../../server.desktop.js';
import { runExternalApiReadTool } from '../externalApiReadHarness.js';
import { DesktopTool } from '../tool.js';
import { resolveItemByNameOrId } from './externalApiToolUtils.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  storyboard: z.string().describe('Storyboard name/id.'),
};
const title = 'Get Storyboard Document';

export const getStoryboardXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getStoryboardXml = new DesktopTool({
    server,
    name: 'get-storyboard-xml',
    title,
    description: 'Return one storyboard document subtree.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, storyboard }, extra): Promise<CallToolResult> => {
      return await getStoryboardXml.logAndExecute({
        extra,
        args: { session, storyboard },
        callback: async () => {
          const result = await runExternalApiReadTool({
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
                'storyboard document',
                async (executor, signal) =>
                  await executor.getStoryboardDocument(storyboardResult.value.id, signal),
              );
            },
          });
          if (result.isErr()) {
            return result;
          }

          return new Ok({
            message: 'Storyboard document returned inline',
            storyboardXml: result.value.xml,
          });
        },
      });
    },
  });

  return getStoryboardXml;
};
