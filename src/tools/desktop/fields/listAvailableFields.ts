import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { listAvailableFields } from '../../../desktop/metadata/index.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { FileNotFoundError, FileReadError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';
import { refreshWorkbookCache } from './refreshWorkbookCache.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; refreshes live workbook first.'),
  workbookFile: z.string().describe('Workbook cache file, not worksheet.'),
};

const pad = (str: string, len: number): string => str + ' '.repeat(Math.max(0, len - str.length));

const typeAbbrev = (type: string): string => {
  if (type === 'quantitative') return 'Q';
  if (type === 'nominal') return 'N';
  if (type === 'ordinal') return 'O';
  return type;
};

const tableauDatatypeLabel = (datatype?: string): string => {
  switch (datatype) {
    case 'integer':
      return 'Number (whole)';
    case 'real':
      return 'Number (decimal)';
    case 'date':
      return 'Date';
    case 'datetime':
      return 'Date & Time';
    case 'string':
      return 'Text';
    case 'boolean':
      return 'True/False';
    default:
      return datatype || 'unknown';
  }
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
      'Returns exact column_ref inputs for field tools. Call before adding fields to Rows, Columns, or encodings.',
      'Reads cache; session refreshes live workbook first. NOT a worksheet file.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false, // With session, rewrites the workbook cache file + sidecar
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, workbookFile }, extra): Promise<CallToolResult> => {
      return await listAvailableFieldsTool.logAndExecute({
        extra,
        args: { session, workbookFile },
        callback: async () => {
          if (!existsSync(workbookFile)) {
            return new FileNotFoundError(workbookFile).toErr();
          }

          let workbookXml: string;
          if (session) {
            const sessionResult = resolveSession(session);
            if (sessionResult.isErr()) {
              return sessionResult.error.toErr();
            }

            // Shared refresh seam (W-23447478): resolve-field reuses the identical
            // re-snapshot + cache/sidecar-rewrite path. list-available-fields fails
            // hard on a refresh failure (never silently lists stale fields).
            const refresh = await refreshWorkbookCache({
              extra,
              workbookFile,
              resolvedSession: sessionResult.value,
              action: 'listing fields',
            });
            if (!refresh.ok) {
              return refresh.error.toErr();
            }
            workbookXml = refresh.xml;
          } else {
            try {
              workbookXml = readFileSync(workbookFile, 'utf-8');
            } catch (error) {
              return new FileReadError(error).toErr();
            }
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
              const typeInfo = `${typeAbbrev(field.type)} (${tableauDatatypeLabel(field.datatype)})`;
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
              const typeInfo = `${typeAbbrev(field.type)} (${tableauDatatypeLabel(field.datatype)})`;
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
