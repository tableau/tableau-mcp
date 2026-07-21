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
  resolveItemByNameOrId,
} from './externalApiToolUtils.js';

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
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          if (!(executor instanceof ExternalApiToolExecutor)) {
            return new ExternalApiRequiredError(getStoryboardInfo.name).toErr();
          }

          const listResult = await executor.listStoryboards(extra.signal);
          if (listResult.isErr()) {
            if (isRouteMissing(listResult.error)) {
              return endpointNotInThisBuild('storyboard list').toErr();
            }
            return new DesktopCommandExecutionError(listResult.error).toErr();
          }

          const storyboardResult = resolveItemByNameOrId(
            'Storyboard',
            storyboard,
            listResult.value.storyboards ?? [],
          );
          if (storyboardResult.isErr()) {
            return storyboardResult.error.toErr();
          }

          const result = await executor.getStoryboard(storyboardResult.value.id, extra.signal);
          if (result.isErr()) {
            if (isRouteMissing(result.error)) {
              return endpointNotInThisBuild('storyboard metadata').toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          return new Ok(result.value);
        },
      });
    },
  });

  return getStoryboardInfo;
};
