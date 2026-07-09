import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { searchWorkbookSchema } from '../../../desktop/search/searchLibrary.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  enumType: z.string().optional().describe('Enum type.'),
  elementType: z.string().optional().describe('Element type.'),
  keywords: z.array(z.string()).optional().describe('Fuzzy keywords.'),
  expandRefs: z.boolean().optional().describe('True: expand ref types inline recursively.'),
};

const title = 'Lookup Workbook Schema (XSD)';
export const getLookupWorkbookSchemaTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'lookup-workbook-schema',
    title,
    description:
      'Search the TWB XSD for enum values, element definitions, attributes, and parentPaths.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { enumType, elementType, keywords, expandRefs },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { enumType, elementType, keywords, expandRefs },
        callback: async () => {
          const result = searchWorkbookSchema({ enumType, elementType, keywords, expandRefs });
          return new Ok(result);
        },
      });
    },
  });

  return tool;
};
