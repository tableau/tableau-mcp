import { createHash } from 'node:crypto';

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { SummaryData, WorksheetItem } from '../../../desktop/externalApi/types.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const DEFAULT_SAMPLE_COUNT = 5;
const DEFAULT_MAX_ROWS = 200;
const MAX_ROWS_CAP = 1000;

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  worksheetName: z.string().min(1).describe('Exact worksheet name.'),
  sampleCount: z
    .number()
    .int()
    .min(2)
    .max(10)
    .optional()
    .describe('Sequential samples; default 5, min 2, max 10.'),
  maxRows: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Rows per sample; default 200, max 1000.'),
};

type ProfileSample = {
  index: number;
  durationMs: number;
  rowCount: number;
  columnCount: number;
  resultFingerprint: string;
};

const title = 'Profile Summary Data';
export const getProfileSummaryDataTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const profileSummaryData = new DesktopTool({
    server,
    name: 'profile-summary-data',
    title,
    description:
      'Measure repeated summary-data query/compute round trips for one worksheet; not worksheet render time.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { session, worksheetName, sampleCount, maxRows },
      extra,
    ): Promise<CallToolResult> => {
      return await profileSummaryData.logAndExecute({
        extra,
        args: { session, worksheetName, sampleCount, maxRows },
        callback: async () => {
          const resolvedSampleCount = sampleCount ?? DEFAULT_SAMPLE_COUNT;
          const resolvedMaxRows = Math.min(maxRows ?? DEFAULT_MAX_ROWS, MAX_ROWS_CAP);
          return await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read, resolvedSession) => {
              const worksheetsResult = await read(
                'worksheet list',
                async (executor, signal) => await executor.listWorksheets(signal),
              );
              if (worksheetsResult.isErr()) return worksheetsResult;

              const worksheetResult = resolveExactWorksheet(
                worksheetName,
                worksheetsResult.value.worksheets ?? [],
              );
              if (worksheetResult.isErr()) return worksheetResult;
              const worksheet = worksheetResult.value;
              if (worksheet.datasources?.length === 0) {
                return new ArgsValidationError(
                  `Worksheet "${worksheet.name}" has no datasource, so summary data cannot be profiled.`,
                ).toErr();
              }

              const samples: ProfileSample[] = [];
              for (let index = 1; index <= resolvedSampleCount; index += 1) {
                const startedAt = performance.now();
                const summaryResult = await read(
                  'summary-data',
                  async (executor, signal) =>
                    await executor.getWorksheetSummaryData(
                      worksheet.id,
                      { maxRows: resolvedMaxRows, ignoreSelection: true },
                      signal,
                    ),
                );
                const durationMs = performance.now() - startedAt;
                if (summaryResult.isErr()) return summaryResult;

                const columns = summaryResult.value.columns ?? [];
                const rows = summaryResult.value.rows ?? [];
                if (columns.length === 0) {
                  return new ArgsValidationError(
                    `Worksheet "${worksheet.name}" returned no columns, so the profile would be misleading.`,
                  ).toErr();
                }
                if (rows.length === 0) {
                  return new ArgsValidationError(
                    `Worksheet "${worksheet.name}" returned no rows, so the profile would be misleading.`,
                  ).toErr();
                }

                samples.push({
                  index,
                  durationMs,
                  rowCount: rows.length,
                  columnCount: columns.length,
                  resultFingerprint: fingerprint({ columns, rows }),
                });
              }

              const durations = samples.map((sample) => sample.durationMs);
              const firstFingerprint = samples[0].resultFingerprint;
              const resultsStable = samples.every(
                (sample) => sample.resultFingerprint === firstFingerprint,
              );

              return new Ok({
                status: resultsStable ? ('success' as const) : ('unstable_results' as const),
                session: resolvedSession,
                worksheet: { id: worksheet.id, name: worksheet.name },
                sampleCount: resolvedSampleCount,
                maxRows: resolvedMaxRows,
                measurement:
                  'Summary-data API query/compute round trip proxy; excludes worksheet resolution and worksheet render time.',
                samples,
                statistics: {
                  medianDurationMs: median(durations),
                  minDurationMs: Math.min(...durations),
                  maxDurationMs: Math.max(...durations),
                  spreadDurationMs: Math.max(...durations) - Math.min(...durations),
                },
                resultsStable,
                stableResultFingerprint: resultsStable ? firstFingerprint : null,
              });
            },
          });
        },
      });
    },
  });

  return profileSummaryData;
};

function resolveExactWorksheet(
  worksheetName: string,
  worksheets: WorksheetItem[],
): Result<WorksheetItem, ArgsValidationError> {
  const matches = worksheets.filter((worksheet) => worksheet.name === worksheetName);
  if (matches.length === 1) return new Ok(matches[0]);
  const available = worksheets.map((worksheet) => worksheet.name).join(', ') || '(none)';
  const detail = matches.length > 1 ? 'matched more than one worksheet' : 'was not found';
  return new ArgsValidationError(
    `Worksheet "${worksheetName}" ${detail}. Use one exact worksheet name. Available worksheets: ${available}`,
  ).toErr();
}

function fingerprint(value: Pick<SummaryData, 'columns' | 'rows'>): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}
