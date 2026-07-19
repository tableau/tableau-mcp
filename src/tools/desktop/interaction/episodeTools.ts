import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { beginEpisode, endEpisode } from '../../../desktop/episode-events.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const beginParamsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  intent: z.string().optional().describe('Optional episode intent label.'),
};

const endParamsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  status: z.enum(['succeeded', 'failed', 'abandoned']).describe('Episode terminal status.'),
  notes: z.string().optional().describe('Optional terminal notes.'),
};

export const getBeginEpisodeTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof beginParamsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'tableau-begin-episode',
    title: 'Begin Episode',
    description: 'Begin an eval episode and return its episode_id.',
    paramsSchema: beginParamsSchema,
    annotations: {
      title: 'Begin Episode',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async ({ session, intent }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, intent },
        getSuccessResult: ({ episode_id }) => ({
          isError: false,
          content: [{ type: 'text', text: `Episode begun episode_id=${episode_id}` }],
        }),
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) return sessionResult.error.toErr();
          return new Ok(
            await beginEpisode(extra.config, { sessionId: sessionResult.value, intent }),
          );
        },
      });
    },
  });
  return tool;
};

export const getEndEpisodeTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof endParamsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'tableau-end-episode',
    title: 'End Episode',
    description: 'End the current eval episode for a Desktop session.',
    paramsSchema: endParamsSchema,
    annotations: {
      title: 'End Episode',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async ({ session, status, notes }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, status, notes },
        getSuccessResult: ({ episode_id }) => ({
          isError: false,
          content: [
            { type: 'text', text: `Episode ended episode_id=${episode_id} status=${status}` },
          ],
        }),
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) return sessionResult.error.toErr();
          const episode = await endEpisode(extra.config, {
            sessionId: sessionResult.value,
            status,
            notes,
          });
          if (!episode) {
            return new ArgsValidationError(
              `No active episode for session '${sessionResult.value}'.`,
            ).toErr();
          }
          return new Ok(episode);
        },
      });
    },
  });
  return tool;
};
