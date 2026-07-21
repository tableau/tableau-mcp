import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { listFields } from '../../../desktop/metadata/index.js';
import {
  FileNotFoundError,
  FileReadError,
  XmlModificationError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  worksheetFile: z.string(),
};

const title = 'List Fields Already Placed on Worksheet';
export const getListFieldsTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const listFieldsTool = new DesktopTool({
    server,
    name: 'list-fields',
    title,
    description: 'List fields on a worksheet.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ worksheetFile }, extra): Promise<CallToolResult> => {
      return await listFieldsTool.logAndExecute({
        extra,
        args: { worksheetFile },
        callback: async () => {
          if (!existsSync(worksheetFile)) {
            return new FileNotFoundError(worksheetFile).toErr();
          }

          let worksheetXml: string;
          try {
            worksheetXml = readFileSync(worksheetFile, 'utf-8');
          } catch (error) {
            return new FileReadError(error).toErr();
          }

          let fields;
          try {
            fields = listFields(worksheetXml);
          } catch (error) {
            return new XmlModificationError(
              error instanceof Error ? error.message : String(error),
            ).toErr();
          }

          if (fields.length === 0) {
            return new Ok({ message: 'No fields found on worksheet.', fields: [] });
          }

          const byLocation: Record<string, typeof fields> = {};
          for (const field of fields) {
            const key =
              field.location === 'encodings'
                ? `${field.location}:${field.encodingType}`
                : field.location;
            if (!byLocation[key]) byLocation[key] = [];
            byLocation[key].push(field);
          }

          const lines: string[] = [`Found ${fields.length} field(s):\n`];
          for (const [location, locationFields] of Object.entries(byLocation)) {
            const displayLocation =
              location === 'rows' ? 'Rows' : location === 'cols' ? 'Columns' : location;
            lines.push(`\n${displayLocation}:`);
            for (const field of locationFields) {
              lines.push(`  [${field.index}] ${field.column}`);
            }
          }

          return new Ok({ message: lines.join('\n'), fields });
        },
      });
    },
  });

  return listFieldsTool;
};
