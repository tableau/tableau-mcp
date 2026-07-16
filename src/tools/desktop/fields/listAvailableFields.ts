import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { listAvailableFields } from '../../../desktop/metadata/index.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import {
  DesktopCommandExecutionError,
  FileReadError,
  McpToolError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';
import { refreshWorkbookCache } from './refreshWorkbookCache.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; refreshes live workbook first.'),
  workbookFile: z
    .string()
    .optional()
    .describe('Optional cached workbook file; omit for the live session workbook.'),
  verbosity: z
    .enum(['slim', 'full'])
    .optional()
    .describe(
      "Response detail. 'full' (default): human-readable table + full per-field metadata incl. exact column_ref. " +
        "'slim': a compact JSON array of { name, caption, role, datatype, semanticRole, datasource } and no table — " +
        'much smaller (~13-18KB vs ~68KB for a wide datasource), for reasoning over fields to pick measures/dimensions. ' +
        'Slim omits column_ref; use resolve-field to get the exact column_ref for the field you commit to.',
    ),
};

class WorkbookFileNotFoundError extends McpToolError {
  constructor(workbookFile: string) {
    super({
      type: 'file-not-found',
      message: [
        `File not found: ${workbookFile}.`,
        'Provide an absolute path to a cached workbook file.',
        'Omit workbookFile to read fields from the live session workbook.',
      ].join(' '),
      statusCode: 404,
    });
  }
}

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

interface SlimField {
  caption: string;
  role: string;
  datatype: string | undefined;
}

type ListAvailableFieldsResult =
  | { message: string; fields: ReturnType<typeof listAvailableFields> }
  | { datasource: string | null; count: number; fields: SlimField[] };

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
      'Omit workbookFile to read the live session workbook. Cached workbook file only; NOT a worksheet file.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false, // With session, rewrites the workbook cache file + sidecar
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, workbookFile, verbosity }, extra): Promise<CallToolResult> => {
      return await listAvailableFieldsTool.logAndExecute<ListAvailableFieldsResult>({
        extra,
        args: { session, workbookFile, verbosity },
        callback: async () => {
          const cacheWorkbookFile = workbookFile?.trim() ? workbookFile : undefined;

          if (cacheWorkbookFile && !existsSync(cacheWorkbookFile)) {
            return new WorkbookFileNotFoundError(cacheWorkbookFile).toErr();
          }

          let workbookXml: string;
          if (session || cacheWorkbookFile === undefined) {
            const sessionResult = resolveSession(session);
            if (sessionResult.isErr()) {
              return sessionResult.error.toErr();
            }
            const resolvedSession = sessionResult.value;

            if (cacheWorkbookFile) {
              // Shared refresh seam (W-23447478): resolve-field reuses the identical
              // re-snapshot + cache/sidecar-rewrite path. list-available-fields fails
              // hard on a refresh failure (never silently lists stale fields).
              const refresh = await refreshWorkbookCache({
                extra,
                workbookFile: cacheWorkbookFile,
                resolvedSession,
                action: 'listing fields',
              });
              if (!refresh.ok) {
                return refresh.error.toErr();
              }
              workbookXml = refresh.xml;
            } else {
              const executor = await extra.getExecutor(resolvedSession);
              const liveWorkbook = await getWorkbookXml({ executor, signal: extra.signal });
              if (liveWorkbook.isErr()) {
                return new DesktopCommandExecutionError(liveWorkbook.error).toErr();
              }
              workbookXml = liveWorkbook.value;
            }
          } else {
            try {
              workbookXml = readFileSync(cacheWorkbookFile, 'utf-8');
            } catch (error) {
              return new FileReadError(error).toErr();
            }
          }

          const fields = listAvailableFields(workbookXml);

          // Slim mode: a compact JSON array for reasoning over fields (pick
          // measures/dimensions), with no ASCII table and no authoring metadata
          // (column_ref, columnInstanceName, formula, …). Each field carries only
          // what a picker needs: caption (the human name, also what
          // generate-insight-cards takes as measures/breakdownDimension), role,
          // and datatype. Per-field `datasource` is intentionally omitted — it's
          // identical for every field and hoisted to the top level once — as are
          // `name` (equals caption for all but calc-copy fields, and unused by
          // the picker) and `semanticRole` (undefined off geo datasources). Cuts
          // a wide-datasource payload from ~68KB to well under the host's
          // inline-output cap so it isn't truncated. Callers that need the exact
          // column_ref resolve it via resolve-field.
          if (verbosity === 'slim') {
            return new Ok({
              datasource: fields.length > 0 ? fields[0].datasource : null,
              count: fields.length,
              fields: fields.map((f) => ({
                caption: f.caption || f.columnName.replace(/^\[|\]$/g, ''),
                role: f.role,
                datatype: f.datatype,
              })),
            });
          }

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
