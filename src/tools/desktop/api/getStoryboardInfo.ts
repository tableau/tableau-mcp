import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import {
  artifactNameParam,
  deprecatedArtifactAliasParam,
  resolveArtifactNameArg,
} from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  storyboardName: artifactNameParam('storyboard').optional(),
  storyboard: deprecatedArtifactAliasParam('storyboard'),
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
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, storyboardName, storyboard }, extra): Promise<CallToolResult> => {
      return await getStoryboardInfo.logAndExecute({
        extra,
        args: { session, storyboardName, storyboard },
        callback: async () => {
          const nameResult = resolveArtifactNameArg('storyboard', storyboardName, storyboard);
          if (nameResult.isErr()) {
            return nameResult;
          }
          const resolvedStoryboardName = nameResult.value;
          return await runExternalApiReadTool({
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
                resolvedStoryboardName,
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
