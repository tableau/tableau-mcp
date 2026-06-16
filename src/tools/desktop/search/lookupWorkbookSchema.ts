import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { searchWorkbookSchema } from '../../../desktop/search/searchLibrary.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  enumType: z.string().optional().describe("Enum type name (e.g., 'PrimitiveType-ST')"),
  elementType: z.string().optional().describe("Element type name (e.g., 'Zone-G')"),
  keywords: z.array(z.string()).optional().describe('Keywords for fuzzy search'),
  expandRefs: z
    .boolean()
    .optional()
    .describe(
      'When true, recursively expand ref types inline (up to 3 levels deep). Use this to see the full structure of complex elements like ObjectGraph-G without chaining multiple lookups.',
    ),
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
      'Search the TWB XSD schema for valid enum values, element definitions, and attribute specs. Returns matching entries with parentPaths showing all valid placements in the workbook tree.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
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
