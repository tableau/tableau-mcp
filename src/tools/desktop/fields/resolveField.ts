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
  workbookFile: z.string().describe('Workbook cache file.'),
  query: z.string().describe('Field reference.'),
  datasource: z.string().optional().describe('Datasource to resolve ambiguity.'),
};

const title = 'Resolve Field Name to column_ref';
export const getResolveFieldTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const resolveFieldTool = new DesktopTool({
    server,
    name: 'resolve-field',
    title,
    description: [
      'Resolve a free-form field reference to an exact column_ref.',
      'ALWAYS reports ambiguity; DO NOT GUESS. Re-call with datasource or list-available-fields; if still ambiguous, ask-user with candidates.',
      'Use before add-field-* when column_ref did not come from list-available-fields.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
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
