import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { checkCacheFileArg, readCacheFileArg } from '../../../../desktop/cachePath.js';
import {
  endpointNotInThisBuild,
  isRouteMissing,
} from '../../../../desktop/externalApi/toolUtils.js';
import {
  type DataModelDatasource,
  describeDataModel,
  listAvailableFields,
} from '../../../../desktop/metadata/index.js';
import { tableLabel } from '../../../../desktop/metadata/objectModel.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import { DesktopCommandExecutionError } from '../../../../errors/mcpToolError.desktop.js';
import { ArgsValidationError, McpToolError } from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
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
    .enum(['slim', 'full', 'model'])
    .optional()
    .describe(
      'full (default): table + fields. slim: candidate tuples + fieldTables. model: tables, joins.',
    ),
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

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function renderDataModel(datasources: DataModelDatasource[]): string {
  if (datasources.length === 0) return 'No datasources found in the workbook.';
  return datasources
    .map((ds) => {
      const caption = (id: string): string => tableLabel(ds.tables, id);
      const lines = [
        `Datasource "${ds.caption ?? ds.name}": ${plural(ds.tables.length, 'table')}, ${plural(ds.relationships.length, 'relationship')}.`,
      ];
      for (const table of ds.tables) {
        const counts =
          table.measures !== undefined && table.dimensions !== undefined
            ? [plural(table.measures, 'measure'), plural(table.dimensions, 'dimension')]
            : ['field ownership unknown'];
        counts.push(plural(table.relationships, 'relationship'));
        lines.push(`- ${table.caption ?? table.id}: ${counts.join(', ')}`);
      }
      const { measures, dimensions } = ds.untiedFields ?? { measures: 0, dimensions: 0 };
      if (measures + dimensions > 0) {
        lines.push(
          `- ${plural(measures + dimensions, 'field')} not tied to a table (mostly calculations): ${plural(measures, 'measure')}, ${plural(dimensions, 'dimension')}`,
        );
      }
      for (const r of ds.relationships) {
        const pairs = r.fields
          .map((f) => `${f.fromField} ${f.operator} ${f.toField}`)
          .join(' AND ');
        lines.push(
          `- ${caption(r.fromTableId)} to ${caption(r.toTableId)} on ${pairs || '(no field pair)'}`,
        );
      }
      for (const problem of ds.problems)
        lines.push(`- problem ${problem.kind}: ${problem.message}`);
      for (const note of ds.notes) lines.push(`- note: ${note}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

type ListAvailableFieldsResult =
  | { message: string; fields: ReturnType<typeof listAvailableFields> }
  | { message: string; datasources: DataModelDatasource[] }
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
      'List datasource fields available for authoring from a live or cached workbook.',
      'Does not report worksheet placements.',
      'Full gives column_ref; slim gives insight candidates and fieldTables; model gives table counts, relationships, problems.',
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

          // A refresh rewrites the cache from the live workbook, so it only needs the path;
          // a cache-only read needs the contents.
          let cachedWorkbook: { path: string; text?: string } | undefined;
          if (cacheWorkbookFile) {
            const notFound = (path: string): McpToolError => new WorkbookFileNotFoundError(path);
            if (session) {
              const checked = checkCacheFileArg('workbookFile', cacheWorkbookFile, notFound);
              if (checked.isErr()) return checked.error.toErr();
              cachedWorkbook = { path: checked.value };
            } else {
              const read = readCacheFileArg('workbookFile', cacheWorkbookFile, notFound);
              if (read.isErr()) return read.error.toErr();
              cachedWorkbook = read.value;
            }
          }

          let workbookXml: string;
          let resolvedSession: string | undefined;
          let executor: Awaited<ReturnType<typeof extra.getExecutor>> | undefined;
          if (session || !cachedWorkbook) {
            const sessionResult = resolveSession(session);
            if (sessionResult.isErr()) {
              return sessionResult.error.toErr();
            }
            resolvedSession = sessionResult.value;

            if (cachedWorkbook) {
              // Shared refresh seam (W-23447478): resolve-field reuses the identical
              // re-snapshot + cache/sidecar-rewrite path. list-available-fields fails
              // hard on a refresh failure (never silently lists stale fields).
              const refresh = await refreshWorkbookCache({
                extra,
                workbookFile: cachedWorkbook.path,
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
            invariant(cachedWorkbook.text !== undefined, 'the cached workbook was read');
            workbookXml = cachedWorkbook.text;
          }

          if (verbosity === 'model') {
            const { datasources } = describeDataModel(workbookXml);
            return new Ok({ message: renderDataModel(datasources), datasources });
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
