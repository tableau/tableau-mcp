import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { wellFormedXmlRule } from '../../../desktop/validation/rules/wellFormedXml.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  xml: z.string().describe('The workbook XML to validate.'),
};

const toolTitle = 'Validate Workbook XML';
export const getValidateWorkbookXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'validate-workbook-xml',
    title: toolTitle,
    description:
      'Check that workbook XML is well-formed (parseable). Does not validate against XSD schema — Tableau validates that when you apply the XML. Use this before apply-workbook to catch basic XML syntax errors early.',
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
            return { content: [{ type: 'text', text: 'Workbook XML is well-formed.' }] };
          }
          const errorList = issues.map((issue, i) => `${i + 1}. ${issue.message}`).join('\n');
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Workbook XML is malformed with ${issues.length} error(s):\n\n${errorList}\n\nFix these errors before calling apply-workbook.`,
              },
            ],
          };
        },
      });
    },
  });
  return tool;
};
