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
};
const title = 'Undo';

export const getUndoWorkbookTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const undoWorkbookTool = new DesktopTool({
    server,
    name: 'undo-workbook',
    title,
    description: 'Reverse the most recent change to the open workbook (Edit > Undo).',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await undoWorkbookTool.logAndExecute({
        extra,
        args: { session },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const executor = await extra.getExecutor(sessionResult.value);

          const result = await executor.undo(extra.signal);
          if (result.isErr()) {
            if (isRouteMissing(result.error)) {
              return endpointNotInThisBuild('undo').toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          return new Ok({
            message:
              result.value.status === 'completed'
                ? 'Undid the last change to the open workbook.'
                : 'Requested undo; Desktop is still applying it.',
          });
        },
      });
    },
  });

  return undoWorkbookTool;
};
