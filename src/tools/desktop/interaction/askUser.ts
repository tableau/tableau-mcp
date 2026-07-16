import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const urgencySchema = z.enum(['blocking', 'soft']);

const paramsSchema = {
  question: z.string().min(1).describe('The clarifying question, written for the end user.'),
  urgency: urgencySchema
    .optional()
    .default('blocking')
    .describe(
      'blocking = stop; do not call more authoring tools until the user answers. soft = proceed with a stated default.',
    ),
  options: z
    .array(z.string())
    .optional()
    .describe('2-5 concrete choices; rendered as a numbered list.'),
};

const title = 'Ask the User a Clarifying Question';

export const getAskUserTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const askUserTool = new DesktopTool({
    server,
    name: 'ask-user',
    title,
    description:
      'Ask instead of guessing when ambiguity would change workbook content: field/sheet/datasource, aggregation/grain, or target. Blocking: stop and wait before more authoring tools.',
    paramsSchema,
    annotations: {
      title,
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
  const prefix = `[${(urgency ?? 'blocking').toUpperCase()}]`;
  const optionsBlock =
    options && options.length > 0
      ? `\n\nOptions:\n${options.map((option, index) => `${index + 1}. ${option}`).join('\n')}`
      : '';
  return `${prefix} ${question}${optionsBlock}`;
}
