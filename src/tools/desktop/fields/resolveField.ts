import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { resolveField } from '../../../desktop/metadata/index.js';
import {
  FileNotFoundError,
  FileReadError,
  XmlModificationError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  workbookFile: z.string().describe('Path to workbook cache file from get-workbook-xml.'),
  query: z
    .string()
    .describe(
      "User-friendly field reference. Examples: 'Profit', 'sum of Profit Ratio', '[Order Date]'.",
    ),
  datasource: z
    .string()
    .optional()
    .describe('Optional datasource name to restrict resolution to (use this to break ambiguity).'),
};

const title = 'Resolve Field Name to column_ref';
export const getResolveFieldTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const resolveFieldTool = new DesktopTool({
    server,
    name: 'resolve-field',
    title,
    description: [
      "Resolve a free-form field reference like 'Profit', 'sum of Profit', or '[Profit Ratio]' to an exact column_ref.",
      'Unlike list-available-fields, this tool ALWAYS reports ambiguity instead of silently picking the first match.',
      'Outcomes (returned in JSON):',
      '- exact: one unambiguous match → use the returned column_ref directly.',
      '- rewritten: matched after a known transformation → use the returned column_ref AND surface the reason to the user.',
      '- ambiguous: more than one match → DO NOT GUESS. Use to disambiguate, or call again with an explicit datasource.',
      '- not_found: no match → fuzzy did-you-mean candidates are returned.',
      'Use this BEFORE any add-field-* call when the column_ref did not come straight from list-available-fields.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ workbookFile, query, datasource }, extra): Promise<CallToolResult> => {
      return await resolveFieldTool.logAndExecute({
        extra,
        args: { workbookFile, query, datasource },
        callback: async () => {
          if (!existsSync(workbookFile)) {
            return new FileNotFoundError(workbookFile).toErr();
          }

          let workbookXml: string;
          try {
            workbookXml = readFileSync(workbookFile, 'utf-8');
          } catch (error) {
            return new FileReadError(error).toErr();
          }

          let resolution;
          try {
            resolution = resolveField(workbookXml, query, { datasource });
          } catch (error) {
            return new XmlModificationError(
              error instanceof Error ? error.message : String(error),
            ).toErr();
          }

          const isError = resolution.kind === 'ambiguous' || resolution.kind === 'not_found';
          return new Ok({ resolution, isError });
        },
      });
    },
  });

  return resolveFieldTool;
};
