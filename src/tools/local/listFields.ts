import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';

import {
  FileNotFoundError,
  FileReadError,
  XmlModificationError,
} from '../../errors/sharedMcpToolError.js';
import { listFields } from '../../metadata/fields.js';
import type { Server } from '../../server.js';
import { artifactFileParam } from '../params.js';
import { SharedTool } from '../shared/tool.js';

const paramsSchema = {
  worksheetFile: artifactFileParam('worksheet'),
};

const title = 'Listing placed fields';
export const getListFieldsTool = (server: Server): SharedTool<typeof paramsSchema> => {
  const listFieldsTool = new SharedTool({
    server,
    name: 'list-fields',
    title,
    description: 'List fields placed on Rows, Columns, or Marks in one cached worksheet file.',
    paramsSchema,
    annotations: {
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
