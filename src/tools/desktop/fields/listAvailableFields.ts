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
      "'full' (default): table + full metadata incl. column_ref. " +
        "'slim': caption/role/datatype grouped by datasource, no table — much smaller for a wide datasource; get column_ref via resolve-field.",
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

/** One datasource's slim fields. Slim always groups by datasource. */
interface SlimDatasourceGroup {
  datasource: string | null;
  // The datasource's contentUrl when it's a published datasource — the input
  // resolve-datasource-luid needs to get the server LUID. Omitted for
  // embedded/local datasources (no server copy, so no contentUrl).
  contentUrl?: string;
  fields: SlimField[];
}

type ListAvailableFieldsResult =
  | { message: string; fields: ReturnType<typeof listAvailableFields> }
  // Slim: fields grouped by datasource so the datasource name is carried once
  // per group, never repeated on every field (keeps slim small). Always this
  // shape — even for a single datasource (one group) — so callers parse one
  // consistent structure.
  | { count: number; datasources: SlimDatasourceGroup[] };

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

          // Slim: caption/role/datatype only, no table — small enough to avoid
          // the inline-output cap. Get column_ref via resolve-field.
          //
          // `listAvailableFields` spans ALL datasources (one flat array, each
          // field carrying its own datasource). Slim always GROUPS by
          // datasource — one group per datasource, in first-seen order — so the
          // datasource name is carried once per group rather than hoisted (which
          // would misattribute every field past the first in a multi-datasource
          // workbook and erase the only disambiguator for same-caption fields)
          // or repeated per field (which would bloat slim). A single-datasource
          // workbook is just one group, so callers always parse one shape.
          if (verbosity === 'slim') {
            const toSlimField = (f: (typeof fields)[number]): SlimField => ({
              caption: f.caption || f.columnName.replace(/^\[|\]$/g, ''),
              role: f.role,
              datatype: f.datatype,
            });

            // Group by datasource name (first-seen order). Each group also
            // carries the datasource's contentUrl (same for all its fields) —
            // present only for published datasources.
            const groups = new Map<string | null, SlimDatasourceGroup>();
            for (const f of fields) {
              let group = groups.get(f.datasource);
              if (!group) {
                group = { datasource: f.datasource, contentUrl: f.contentUrl, fields: [] };
                groups.set(f.datasource, group);
              }
              group.fields.push(toSlimField(f));
            }
            return new Ok({
              count: fields.length,
              datasources: Array.from(groups.values()),
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
