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
const title = 'Redo';

export const getRedoWorkbookTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const redoWorkbookTool = new DesktopTool({
    server,
    name: 'redo-workbook',
    title,
    description: 'Reapply the change most recently undone on the open workbook (Edit > Redo).',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await redoWorkbookTool.logAndExecute({
        extra,
        args: { session },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const executor = await extra.getExecutor(sessionResult.value);

          const result = await executor.redo(extra.signal);
          if (result.isErr()) {
            if (isRouteMissing(result.error)) {
              return endpointNotInThisBuild('redo').toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          return new Ok({
            message:
              result.value.status === 'completed'
                ? 'Reapplied the most recently undone change to the open workbook.'
                : 'Requested redo; Desktop is still applying it.',
          });
        },
      });
    },
  });

  return redoWorkbookTool;
};
