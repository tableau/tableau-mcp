import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
  isStartPageVisible: z
    .boolean()
    .describe('Whether the Tableau Desktop Start Page should be visible.'),
};

type SetStartPageVisibilityResult = {
  isStartPageVisible: boolean;
  message: string;
};

const title = 'Set Start Page Visibility';

export const getSetStartPageVisibilityTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const setStartPageVisibilityTool = new DesktopTool({
    server,
    name: 'set-start-page-visibility',
    minApiVersion: '0.2.11',
    title,
    description:
      "Show or hide Tableau Desktop's Start Page and return its actual resulting visibility.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session, isStartPageVisible }, extra): Promise<CallToolResult> => {
      return await setStartPageVisibilityTool.logAndExecute<SetStartPageVisibilityResult>({
        extra,
        args: { session, isStartPageVisible },
        callback: async () => {
          const result = await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read(
                'start-page visibility',
                async (executor, signal) =>
                  await executor.setStartPageVisibility(isStartPageVisible, signal),
              ),
          });
          if (result.isErr()) {
            return result;
          }

          const actualVisibility = result.value.isStartPageVisible;
          return new Ok({
            isStartPageVisible: actualVisibility,
            message: `The Tableau Desktop Start Page is ${actualVisibility ? 'visible' : 'hidden'}.`,
          });
        },
      });
    },
  });

  return setStartPageVisibilityTool;
};
