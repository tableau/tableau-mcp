import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';
import {
  endpointNotInThisBuild,
  ExternalApiRequiredError,
  isRouteMissing,
} from './externalApiToolUtils.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  worksheetId: z.string().describe('Worksheet id.'),
};
const title = 'Get Worksheet Info';

export const getWorksheetInfoTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getWorksheetInfo = new DesktopTool({
    server,
    name: 'get-worksheet-info',
    title,
    description: 'Read one worksheet by id.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, worksheetId }, extra): Promise<CallToolResult> => {
      return await getWorksheetInfo.logAndExecute({
        extra,
        args: { session, worksheetId },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          if (!(executor instanceof ExternalApiToolExecutor)) {
            return new ExternalApiRequiredError(getWorksheetInfo.name).toErr();
          }

          const result = await executor.getWorksheet(worksheetId, extra.signal);
          if (result.isErr()) {
            if (isRouteMissing(result.error)) {
              return endpointNotInThisBuild('worksheet metadata').toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          return new Ok(result.value);
        },
      });
    },
  });

  return getWorksheetInfo;
};
