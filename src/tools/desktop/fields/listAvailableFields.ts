import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { listAvailableFields } from '../../../desktop/metadata/index.js';
import { FileNotFoundError, FileReadError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  workbookFile: z.string().describe('Workbook cache file, not worksheet.'),
};

const pad = (str: string, len: number): string => str + ' '.repeat(Math.max(0, len - str.length));

const typeAbbrev = (type: string): string => {
  if (type === 'quantitative') return 'Q';
  if (type === 'nominal') return 'N';
  if (type === 'ordinal') return 'O';
  return type;
};

const title = 'List All Available Fields in Workbook Datasources';
export const getListAvailableFieldsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const listAvailableFieldsTool = new DesktopTool({
    server,
    name: 'list-available-fields',
    title,
    description: [
      'List ALL fields available in workbook datasources.',
      'Returns exact column_ref inputs for field tools. Call before adding rows/cols/encodings.',
      'Reads the workbook cache file, NOT a worksheet file.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ workbookFile }, extra): Promise<CallToolResult> => {
      return await listAvailableFieldsTool.logAndExecute({
        extra,
        args: { workbookFile },
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

          const fields = listAvailableFields(workbookXml);

          if (fields.length === 0) {
            return new Ok({
              message: 'No fields found in the workbook datasources.',
              fields: [],
            });
          }

          const dimensions = fields.filter((f) => f.role === 'dimension');
          const measures = fields.filter((f) => f.role === 'measure');
          const datasourceName = fields[0].datasource;

          let output = `Found ${fields.length} fields in "${datasourceName}":\n\n`;

          if (dimensions.length > 0) {
            output += `DIMENSIONS (${dimensions.length}):\n`;
            output += pad('Name', 30) + ' | ' + pad('Local Name', 30) + ' | Type\n';
            output += '-'.repeat(30) + '-+-' + '-'.repeat(30) + '-+-' + '-'.repeat(15) + '\n';
            for (const field of dimensions) {
              const displayName = field.caption || field.columnName.replace(/^\[|\]$/g, '');
              const cleanName = field.columnName.replace(/^\[|\]$/g, '');
              const localNameDisplay = displayName === cleanName ? '(same)' : cleanName;
              const typeInfo = `${typeAbbrev(field.type)} (${field.datatype || 'unknown'})`;
              const aggregated = field.isAggregated ? ' [AGG]' : '';
              output +=
                pad(displayName, 30) +
                ' | ' +
                pad(localNameDisplay, 30) +
                ' | ' +
                typeInfo +
                aggregated +
                '\n';
            }
            output += '\n';
          }

          if (measures.length > 0) {
            output += `MEASURES (${measures.length}):\n`;
            output += pad('Name', 30) + ' | ' + pad('Local Name', 30) + ' | Type\n';
            output += '-'.repeat(30) + '-+-' + '-'.repeat(30) + '-+-' + '-'.repeat(15) + '\n';
            for (const field of measures) {
              const displayName = field.caption || field.columnName.replace(/^\[|\]$/g, '');
              const cleanName = field.columnName.replace(/^\[|\]$/g, '');
              const localNameDisplay = displayName === cleanName ? '(same)' : cleanName;
              const typeInfo = `${typeAbbrev(field.type)} (${field.datatype || 'unknown'})`;
              const aggregated = field.isAggregated ? ' [AGG]' : '';
              output +=
                pad(displayName, 30) +
                ' | ' +
                pad(localNameDisplay, 30) +
                ' | ' +
                typeInfo +
                aggregated +
                '\n';
            }
            output += '\n';
          }

          return new Ok({ message: output, fields });
        },
      });
    },
  });

  return listAvailableFieldsTool;
};
