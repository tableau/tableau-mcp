import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { resolveSession } from '../../../desktop/sessionResolution.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';
import { endpointNotInThisBuild, isRouteMissing } from './externalApiToolUtils.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  index: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      '0-based tab position to insert the new storyboard before, shifting the tab at that ' +
        'position (and beyond) right. Omit or pass a value >= the current tab count to append ' +
        'at the end.',
    ),
};
const title = 'Create Blank Storyboard';

export const getCreateStoryboardBlankTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const createStoryboardBlankTool = new DesktopTool({
    server,
    name: 'create-storyboard-blank',
    title,
    description:
      'Create a new empty storyboard (story) in the open workbook, with a Tableau-generated name.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session, index }, extra): Promise<CallToolResult> => {
      return await createStoryboardBlankTool.logAndExecute({
        extra,
        args: { session, index },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const executor = await extra.getExecutor(sessionResult.value);

          const result = await executor.createBlankStoryboard(index, extra.signal);
          if (result.isErr()) {
            if (isRouteMissing(result.error)) {
              return endpointNotInThisBuild('create-storyboard-blank').toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          return new Ok({
            message:
              result.value.status === 'completed'
                ? 'Created a blank storyboard.'
                : 'Requested a new blank storyboard; Desktop is still creating it.',
          });
        },
      });
    },
  });

  return createStoryboardBlankTool;
};
