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
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          if (!(executor instanceof ExternalApiToolExecutor)) {
            return new ExternalApiRequiredError(getStoryboardXml.name).toErr();
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

          const result = await executor.getStoryboardDocument(
            storyboardResult.value.id,
            extra.signal,
          );
          if (result.isErr()) {
            if (isRouteMissing(result.error)) {
              return endpointNotInThisBuild('storyboard document').toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
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
