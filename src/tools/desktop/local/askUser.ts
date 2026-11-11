import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

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
    callback: async ({ question, urgency, options }, extra): Promise<CallToolResult> => {
      return await askUserTool.logAndExecute<string>({
        extra,
        args: { question, urgency, options },
        callback: async () => new Ok(renderAskUser({ question, urgency, options })),
        getSuccessResult: (text) => ({
          isError: false,
          content: [{ type: 'text', text }],
        }),
      });
    },
  });

  return askUserTool;
};

function renderAskUser({
  question,
  urgency,
  options,
}: {
  question: string;
  urgency?: z.infer<typeof urgencySchema>;
  options?: string[];
}): string {
  const resolvedUrgency = urgency ?? 'blocking';
  const prefix = `[${resolvedUrgency.toUpperCase()}]`;
  const optionsBlock =
    options && options.length > 0
      ? `\n\nOptions:\n${options.map((option, index) => `${index + 1}. ${option}`).join('\n')}`
      : '';
  // Over the blocking fallback there's no human to answer, so a bare echo leaves the model narrating
  // its choice and stopping. Steer it to proceed. Phrased conditionally so it stays correct on the
  // interactive path, where the host collects a real answer first.
  const proceedSteer =
    resolvedUrgency === 'blocking'
      ? '\n\n(If no interactive answer is available and you must proceed on your own, pick the ' +
        'best-supported option and continue by emitting the next tool-call block now — do not stop ' +
        'at a prose summary of your choice.)'
      : '';
  return `${prefix} ${question}${optionsBlock}${proceedSteer}`;
}
