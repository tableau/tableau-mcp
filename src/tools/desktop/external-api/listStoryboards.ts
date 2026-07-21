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
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          if (!(executor instanceof ExternalApiToolExecutor)) {
            return new ExternalApiRequiredError(listStoryboards.name).toErr();
          }

          const result = await executor.listStoryboards(extra.signal);
          if (result.isErr()) {
            if (isRouteMissing(result.error)) {
              return endpointNotInThisBuild('storyboard list').toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          return new Ok({ storyboards: result.value.storyboards ?? [] });
        },
      });
    },
  });

  return listStoryboards;
};
