import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { deprecatedArtifactAliasParam, resolveArtifactNameArg } from '../params.js';
import { jsonToolResult } from '../structuredContent.js';
import { DesktopTool } from '../tool.js';
import { fetchWorksheetSummaryData, type SummaryRowOrder } from './summaryDataCore.js';

const DEFAULT_MAX_ROWS = 200;
const MAX_ROWS_CAP = 1000;

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  worksheetName: z.string().optional().describe('Worksheet name/id; omit if unique.'),
  worksheet: deprecatedArtifactAliasParam('worksheet'),
  maxRows: z.number().int().positive().optional().describe('Default 200; max 1000.'),
  columns: z
    .array(z.string())
    .optional()
    .describe('Field names to restrict the returned columns (e.g. "Region").'),
};

type SummaryDataResult = {
  worksheet: { id: string; name: string };
  maxRows: number;
  shape: string;
  rowOrder: SummaryRowOrder;
  summaryData: { columns: unknown[]; rows: unknown[] };
};

const title = 'Get Summary Data';
export const getSummaryDataTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const getSummaryData = new DesktopTool({
    server,
    name: 'get-summary-data',
    title,
    description:
      'Read the aggregated summary rows on a populated worksheet (only the fields on the view).',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { session, worksheetName, worksheet, maxRows, columns },
      extra,
    ): Promise<CallToolResult> => {
      return await getSummaryData.logAndExecute({
        extra,
        args: { session, worksheetName, worksheet, maxRows, columns },
        callback: async () => {
          // The worksheet selector stays optional (omit when unique); the resolver here
          // only rejects a worksheetName/alias conflict and coalesces the two keys.
          const worksheetArg = resolveArtifactNameArg('worksheet', worksheetName, worksheet, {
            allowMissing: true,
          });
          if (worksheetArg.isErr()) {
            return worksheetArg;
          }
          const resolvedMaxRows = Math.min(maxRows ?? DEFAULT_MAX_ROWS, MAX_ROWS_CAP);
          return await runExternalApiReadTool<SummaryDataResult>({
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              const summaryResult = await fetchWorksheetSummaryData({
                read,
                worksheet: worksheetArg.value,
                maxRows: resolvedMaxRows,
                columns,
                materializeEmpty: true,
              });
              if (summaryResult.isErr()) {
                return summaryResult.error.error.toErr();
              }
              const resolvedWorksheet = summaryResult.value.worksheet;
              const dataColumns = summaryResult.value.columns;
              const dataRows = summaryResult.value.rows;
              return new Ok({
                worksheet: { id: resolvedWorksheet.id, name: resolvedWorksheet.name },
                maxRows: resolvedMaxRows,
                shape: `${dataRows.length} rows x ${dataColumns.length} columns`,
                rowOrder: summaryResult.value.rowOrder,
                summaryData: { columns: dataColumns, rows: dataRows },
              });
            },
          });
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
    },
  });

  return getSummaryData;
};
