import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { DesktopMcpServer } from '../../../server.desktop.js';
import { jsonToolResult, withUtterance } from '../structuredContent.js';
import { DesktopTool } from '../tool.js';
import { ASK_TOOL_META, utteranceToolMetaToWire } from '../utterance.js';
import { askUtteranceFromInput } from '../utteranceMark.js';

const urgencySchema = z.enum(['blocking', 'soft']);

const paramsSchema = {
  question: z.string().min(1).describe('Question for the user.'),
  urgency: urgencySchema
    .optional()
    .default('blocking')
    .describe('blocking=wait; soft=state a default.'),
  options: z.array(z.string()).optional().describe('2-5 choices.'),
};

const title = 'Ask the User a Clarifying Question';

export const getAskUserTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const askUserTool = new DesktopTool({
    server,
    name: 'ask-user',
    title,
    description: 'Ask instead of guessing; stop and wait.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    meta: { utterance: utteranceToolMetaToWire(ASK_TOOL_META) },
    callback: async ({ question, urgency, options }, extra): Promise<CallToolResult> => {
      return await askUserTool.logAndExecute({
        extra,
        args: { question, urgency, options },
        callback: async () => {
          const payload =
            options === undefined ? { question, urgency } : { question, urgency, options };
          return new Ok(payload);
        },
        getSuccessResult: (payload) =>
          jsonToolResult(withUtterance(payload, askUtteranceFromInput(payload)), {
            isError: false,
          }),
      });
    },
  });

  return askUserTool;
};
