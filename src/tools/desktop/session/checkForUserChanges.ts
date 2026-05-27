import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { GetEventsFailedError } from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z
    .string()
    .describe('Session ID from tool that lists running Tableau Desktop instances.'),
  sinceSequence: z
    .number()
    .optional()
    .describe(
      'Sequence number to check since. If omitted, returns current latest sequence to establish a checkpoint.',
    ),
};

type CheckForUserChangesResult = {
  message: string;
  instructions?: string;
  events?: Array<string>;
  currentSequence?: number;
};

const title = 'Check for User Changes';
export const getCheckForUserChangesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const checkForUserChangesTool = new DesktopTool({
    server,
    name: 'check-for-user-changes',
    title,
    description: [
      'Detect if the user has made changes to the workbook.',
      'Pass the sequence number from a previous call to check for new events.',
      'If no sequence is provided, returns the current latest sequence (use this to establish a checkpoint).',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, sinceSequence }, extra): Promise<CallToolResult> => {
      return await checkForUserChangesTool.logAndExecute<CheckForUserChangesResult>({
        extra,
        args: { session, sinceSequence },
        callback: async () => {
          const executor = await extra.getExecutor(session);
          const result = await executor.getEvents({
            signal: extra.signal,
            sinceSequence,
          });

          if (result.isErr()) {
            return new GetEventsFailedError(
              `Failed to get events: ${getExceptionMessage(result.error)}`,
            ).toErr();
          }

          const { events, latest_sequence: latestSequence, count } = result.value;

          if (sinceSequence === undefined) {
            log({
              message: 'No sinceSequence provided, returning current latest sequence',
              level: 'info',
              logger: 'checkForUserChangesTool',
              data: result.value,
            });

            return new Ok({
              message: `Current event sequence checkpoint: ${latestSequence}.`,
              instructions:
                'Use this sequence number in subsequent calls to check for user changes.',
            });
          }

          if (count === 0 || events.length === 0) {
            log({
              message: 'No user changes detected',
              level: 'info',
              logger: 'checkForUserChangesTool',
              data: {
                sinceSequence,
                latestSequence,
              },
            });

            return new Ok({
              message: `No user changes detected since sequence ${sinceSequence}.`,
              currentSequence: latestSequence,
            });
          }

          log({
            message: 'User changes detected',
            level: 'info',
            logger: 'checkForUserChangesTool',
            data: {
              sinceSequence,
              latestSequence,
              count,
            },
          });

          return new Ok({
            message: `⚠️ User changes detected! ${count} ${count === 1 ? 'event' : 'events'} occurred since sequence ${sinceSequence}. The user may have modified the workbook.`,
            events: events.map((e) => `[${e.sequence}] ${e.timestamp}: ${e.type}`),
            instructions: 'Consider refreshing the workbook state before making further changes.',
            currentSequence: latestSequence,
          });
        },
      });
    },
  });

  return checkForUserChangesTool;
};
