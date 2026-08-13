import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  endpointNotInThisBuild,
  isRouteMissing,
} from '../../../../desktop/externalApi/toolUtils.js';
import { listAvailableFields } from '../../../../desktop/metadata/index.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  FileReadError,
  McpToolError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { DesktopTool } from '../../tool.js';
import {
  filterListAvailableFieldsSlimByLuid,
  ListAvailableFieldsSlimResult,
  projectListAvailableFieldsSlim,
} from './listAvailableFieldsSlim.js';
import { refreshWorkbookCache } from './refreshWorkbookCache.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; refresh live workbook.'),
  workbookFile: z.string().optional().describe('Cache file; omit for live session.'),
  verbosity: z
    .enum(['slim', 'full'])
    .optional()
    .describe('full (default): table + fields. slim: candidate tuples by datasource.'),
  hasLuid: z.boolean().optional().describe('Slim: LUID-backed only; live required.'),
  luids: z.array(z.string().min(1)).optional().describe('Slim: LUIDs; [] all; any miss errors.'),
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

const pad = (str: string, len: number): string => {
  if (str.length <= len) {
    return str + ' '.repeat(len - str.length);
  }
  // Truncate in the middle, not the tail: auto-generated names like
  // Calculation_<id> often differ only in their final digits, so keeping the
  // tail as well as the head keeps otherwise-identical rows distinguishable.
  const keep = len - 1;
  const head = Math.ceil(keep / 2);
  return str.slice(0, head) + '…' + str.slice(str.length - (keep - head));
};

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

type AvailableField = ReturnType<typeof listAvailableFields>[number];

function renderFieldRows(fields: AvailableField[]): string {
  let output = pad('Name', 30) + ' | ' + pad('Local Name', 30) + ' | Type\n';
  output += '-'.repeat(30) + '-+-' + '-'.repeat(30) + '-+-' + '-'.repeat(15) + '\n';
  for (const field of fields) {
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
  return output;
}

function renderFieldTable(fields: AvailableField[]): string {
  const dimensions = fields.filter((f) => f.role === 'dimension');
  const measures = fields.filter((f) => f.role === 'measure');
  let output = '';
  if (dimensions.length > 0) {
    output += `DIMENSIONS (${dimensions.length}):\n` + renderFieldRows(dimensions) + '\n';
  }
  if (measures.length > 0) {
    output += `MEASURES (${measures.length}):\n` + renderFieldRows(measures) + '\n';
  }
  return output;
}

type ListAvailableFieldsResult =
  | { message: string; fields: ReturnType<typeof listAvailableFields> }
  | ListAvailableFieldsSlimResult;

const title = 'Listing available fields';
export const getListAvailableFieldsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const listAvailableFieldsTool = new DesktopTool({
    server,
    name: 'list-available-fields',
    title,
    description: [
      'List datasource fields for exploration/field questions/non-template authoring.',
      'Available anytime; template building also resolves fields directly.',
      'Full gives column_ref; slim gives insight candidate tuples.',
    ].join(' '),
    paramsSchema,
    annotations: {
      readOnlyHint: false, // With session, rewrites the workbook cache file + sidecar
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { session, workbookFile, verbosity, hasLuid, luids },
      extra,
    ): Promise<CallToolResult> => {
      return await listAvailableFieldsTool.logAndExecute<ListAvailableFieldsResult>({
        extra,
        args: { session, workbookFile, verbosity, hasLuid, luids },
        callback: async () => {
          if (luids !== undefined && hasLuid !== true) {
            return new ArgsValidationError('luids requires hasLuid: true.').toErr();
          }
          if ((hasLuid !== undefined || luids !== undefined) && verbosity !== 'slim') {
            return new ArgsValidationError('hasLuid and luids require verbosity: slim.').toErr();
          }

          const cacheWorkbookFile = workbookFile?.trim() ? workbookFile : undefined;
          const explicitSession = session?.trim();
          if (
            hasLuid === true &&
            cacheWorkbookFile &&
            (!explicitSession || explicitSession.toLowerCase() === 'default')
          ) {
            return new ArgsValidationError(
              'LUID filtering with workbookFile requires an explicit live session.',
            ).toErr();
          }

          if (cacheWorkbookFile && !existsSync(cacheWorkbookFile)) {
            return new WorkbookFileNotFoundError(cacheWorkbookFile).toErr();
          }

          let workbookXml: string;
          let resolvedSession: string | undefined;
          let executor: Awaited<ReturnType<typeof extra.getExecutor>> | undefined;
          if (session || cacheWorkbookFile === undefined) {
            const sessionResult = resolveSession(session);
            if (sessionResult.isErr()) {
              return sessionResult.error.toErr();
            }
            resolvedSession = sessionResult.value;

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
              executor = await extra.getExecutor(resolvedSession);
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

          if (verbosity === 'slim') {
            const result = projectListAvailableFieldsSlim(fields);
            if (hasLuid !== true) return new Ok(result);

            if (executor === undefined) {
              if (resolvedSession === undefined) {
                return new ArgsValidationError(
                  'LUID filtering requires a live Desktop session.',
                ).toErr();
              }
              executor = await extra.getExecutor(resolvedSession);
            }

            const workbookDatasourceResult = await executor.listWorkbookDatasources(extra.signal);
            if (workbookDatasourceResult.isErr()) {
              if (isRouteMissing(workbookDatasourceResult.error)) {
                return endpointNotInThisBuild('workbook datasources').toErr();
              }
              return new DesktopCommandExecutionError(workbookDatasourceResult.error).toErr();
            }

            return filterListAvailableFieldsSlimByLuid({
              result,
              workbookDatasources: workbookDatasourceResult.value.datasources ?? [],
              luids: luids ?? [],
            });
          }

          if (fields.length === 0) {
            return new Ok({
              message: 'No fields found in the workbook datasources.',
              fields: [],
            });
          }

          const datasources = [...new Set(fields.map((f) => f.datasource))];

          let output: string;
          if (datasources.length === 1) {
            output =
              `Found ${fields.length} fields in "${datasources[0]}":\n\n` +
              renderFieldTable(fields);
          } else {
            output = `Found ${fields.length} fields across ${datasources.length} datasources:\n\n`;
            for (const ds of datasources) {
              const dsFields = fields.filter((f) => f.datasource === ds);
              output += `Datasource "${ds}" (${dsFields.length}):\n\n` + renderFieldTable(dsFields);
            }
          }

          return new Ok({ message: output, fields });
        },
      });
    },
  });

  return listAvailableFieldsTool;
};
