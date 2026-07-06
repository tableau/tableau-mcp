import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { wellFormedXmlRule } from '../../../desktop/validation/rules/wellFormedXml.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  xml: z.string().describe('The worksheet XML to validate.'),
};

const toolTitle = 'Validate Worksheet XML';
export const getValidateWorksheetXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'validate-worksheet-xml',
    title: toolTitle,
    description:
      'Check that worksheet XML is well-formed (parseable). Does not validate against XSD schema — Tableau validates that when you apply the XML. Use this before apply-worksheet to catch basic XML syntax errors early.',
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
            return { content: [{ type: 'text', text: 'Worksheet XML is well-formed.' }] };
          }
          const errorList = issues.map((issue, i) => `${i + 1}. ${issue.message}`).join('\n');
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Worksheet XML is malformed with ${issues.length} error(s):\n\n${errorList}\n\nFix these errors before calling apply-worksheet.`,
              },
            ],
          };
        },
      });
    },
  });
  return tool;
};
