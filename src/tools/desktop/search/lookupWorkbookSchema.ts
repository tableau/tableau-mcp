import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { searchWorkbookSchema } from '../../../desktop/search/searchLibrary.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  enumType: z.string().optional(),
  elementType: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  expandRefs: z.boolean().optional(),
};

const title = 'Lookup Workbook Schema (XSD)';
export const getLookupWorkbookSchemaTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'lookup-workbook-schema',
    title,
    description: 'Search the TWB XSD.',
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
