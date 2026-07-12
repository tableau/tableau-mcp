import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { wellFormedXmlRule } from '../../../desktop/validation/rules/wellFormedXml.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  xml: z.string().describe('The worksheet content to validate.'),
};

const toolTitle = 'Check Worksheet Structure';
export const getValidateWorksheetXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'validate-worksheet-xml',
    title: toolTitle,
    description:
      'Check that worksheet content is well-formed (parseable). Tableau runs deeper validation when you apply the update. Use this before apply-worksheet to catch basic structure errors early.',
    paramsSchema,
    annotations: {
      title: toolTitle,
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ xml }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { xml },
        callback: async () => new Ok(wellFormedXmlRule.validate(xml)),
        getSuccessResult: (issues) => {
          if (issues.length === 0) {
            return { content: [{ type: 'text', text: 'Worksheet structure is well-formed.' }] };
          }
          const errorList = issues.map((issue, i) => `${i + 1}. ${issue.message}`).join('\n');
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Worksheet structure has ${issues.length} error(s):\n\n${errorList}\n\nFix these errors before calling apply-worksheet.`,
              },
            ],
          };
        },
      });
    },
  });
  return tool;
};
