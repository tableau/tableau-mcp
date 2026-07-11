// refine-worksheet — the refine fast lane. Routes refine-shaped follow-ups ("make that
// the top five", "flip the sort") to ONE bounded, validated, worksheet-level mutation
// instead of whole-workbook XML surgery.
//
// Flow: get-worksheet-xml (ONE fetch) -> pure minimal patch (envelope check inside the
// planner) -> ensureUserNamespace -> preflight validation -> load-worksheet-xml (apply
// ONCE, itself validated) -> get-worksheet-xml readback -> confirm the expected node.
// On ANY out-of-envelope condition it REFUSES with a precise reason and hands back to the
// standard authoring path — it never retries, never applies twice, never falls back to
// whole-workbook XML. The WHAT (which nodes, which refusals) lives in the pure planners
// under src/desktop/refine/refineWorksheet.ts; this file is the I/O wrapper + registration.

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getWorksheetXml } from '../../../desktop/commands/workbook/getWorksheetXml.js';
import { loadWorksheetXml } from '../../../desktop/commands/workbook/loadWorksheetXml.js';
import {
  confirmSortDirectionApplied,
  confirmTopNApplied,
  planSortDirection,
  planTopN,
  type SortDirection,
  type TopNEnd,
} from '../../../desktop/refine/refineWorksheet.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { ensureUserNamespace } from '../../../desktop/templates/injectTemplateCore.js';
import { runValidation } from '../../../desktop/validation/registry.js';
import { ValidationIssue } from '../../../desktop/validation/types.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  GetWorksheetXmlFailedError,
  UnknownError,
  WorksheetXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

type RefineOperation = 'top_n' | 'sort_direction';

type RefineWorksheetToolResult =
  | { refined: true; operation: RefineOperation; worksheetName: string; message: string }
  | { refined: false; operation: RefineOperation; worksheetName: string; reason: string };

/** A hand-back-to-the-standard-path refusal — not an error, so isError stays false. */
function refusal(
  operation: RefineOperation,
  worksheetName: string,
  reason: string,
): Ok<RefineWorksheetToolResult> {
  return new Ok({ refined: false, operation, worksheetName, reason });
}

/** Compact one-line summary of the error-severity preflight issues (rule id + message). */
function formatValidationErrors(issues: ValidationIssue[]): string {
  return issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => `${issue.ruleId}: ${issue.message}`)
    .join('; ');
}

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  worksheetName: z.string().min(1).describe('Existing worksheet name to refine.'),
  operation: z
    .enum(['top_n', 'sort_direction'])
    .describe(
      'top_n: top/bottom N of the single dimension by the single measure. sort_direction: flip the single computed-sort.',
    ),
  topN: z
    .object({
      n: z.number().int().min(1).max(50).describe('Members to keep (integer 1..50).'),
      end: z.enum(['top', 'bottom']).optional().describe('top (default) or bottom.'),
    })
    .optional()
    .describe('Required when operation=top_n.'),
  sortDirection: z
    .object({
      direction: z.enum(['ASC', 'DESC']).describe('ASC or DESC.'),
    })
    .optional()
    .describe('Required when operation=sort_direction.'),
};

const title = 'Refine Worksheet';

export const REFINE_WORKSHEET_DESCRIPTION = [
  'Refine an EXISTING worksheet with ONE bounded, validated mutation (applies once, then reads',
  'back to confirm). Use WHEN the user asks to limit an existing chart to its top/bottom N',
  'members, or to flip its sort direction — NOT to build a new chart. REFUSES (defer to the',
  'normal build path) on anything ambiguous/out of envelope: multiple dims/measures, n outside',
  '1..50, sets/params/calcs, an existing Top-N, or a nested/absent/multiple computed-sort.',
].join(' ');

export const getRefineWorksheetTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const refineWorksheetTool = new DesktopTool({
    server,
    name: 'refine-worksheet',
    title,
    description: REFINE_WORKSHEET_DESCRIPTION,
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true, // mutates the named worksheet
      idempotentHint: false,
    },
    callback: async (
      { session, worksheetName, operation, topN, sortDirection },
      extra,
    ): Promise<CallToolResult> => {
      return await refineWorksheetTool.logAndExecute<RefineWorksheetToolResult>({
        extra,
        args: { session, worksheetName, operation, topN, sortDirection },
        callback: async () => {
          if (!worksheetName || !worksheetName.trim()) {
            return new ArgsValidationError('worksheetName is required.').toErr();
          }

          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);

          // 1. ONE fetch of the target worksheet.
          const fetched = await getWorksheetXml({
            worksheetName,
            executor,
            signal: extra.signal,
          });
          if (fetched.isErr()) {
            const { type, error } = fetched.error;
            switch (type) {
              case 'get-worksheet-xml-error':
                return new GetWorksheetXmlFailedError(error).toErr();
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              default: {
                const _: never = type;
                return new UnknownError(error).toErr();
              }
            }
          }
          const sourceXml = fetched.value;

          // 2. Pure minimal patch + the readback confirmation target for this operation.
          let patched: string;
          let confirm: (readback: string) => boolean;
          let nodeLabel: string;

          if (operation === 'top_n') {
            const plan = planTopN(sourceXml, {
              n: topN?.n as number,
              end: topN?.end as TopNEnd | undefined,
            });
            if (!plan.ok) {
              return refusal(operation, worksheetName, plan.reason);
            }
            patched = plan.xml;
            const col = plan.filterColumn;
            confirm = (rb) => confirmTopNApplied(rb, col);
            nodeLabel = `Top-N filter (function="end") on ${col}`;
          } else {
            const plan = planSortDirection(sourceXml, {
              direction: sortDirection?.direction as SortDirection,
            });
            if (!plan.ok) {
              return refusal(operation, worksheetName, plan.reason);
            }
            patched = plan.xml;
            const col = plan.column;
            const dir = plan.direction;
            confirm = (rb) => confirmSortDirectionApplied(rb, col, dir);
            nodeLabel = `<computed-sort direction="${dir}">${col ? ` on ${col}` : ''}`;
          }

          // 3. Declare the user: namespace before the patch is parsed/applied.
          const prepared = ensureUserNamespace(patched);

          // 4. Preflight validation — an error-severity issue means we do NOT apply.
          const validation = runValidation(prepared, 'worksheet');
          if (!validation.valid) {
            return refusal(
              operation,
              worksheetName,
              `preflight validation failed — not applying. ${formatValidationErrors(validation.issues)}`,
            );
          }

          // 5. Apply ONCE through the shared, validated worksheet apply path. On failure:
          // STOP, no retry, no whole-workbook fallback.
          const applied = await loadWorksheetXml({
            worksheetName,
            xml: prepared,
            executor,
            signal: extra.signal,
          });
          if (applied.isErr()) {
            const { type, error } = applied.error;
            switch (type) {
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              case 'load-worksheet-xml-error':
                return new WorksheetXmlLoadFailedError(error).toErr();
              default: {
                const _: never = type;
                return new UnknownError(String(type)).toErr();
              }
            }
          }

          // 6. Read back and confirm the expected node landed durably.
          const readback = await getWorksheetXml({
            worksheetName,
            executor,
            signal: extra.signal,
          });
          if (readback.isErr()) {
            const { type, error } = readback.error;
            switch (type) {
              case 'get-worksheet-xml-error':
                return new GetWorksheetXmlFailedError(error).toErr();
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              default: {
                const _: never = type;
                return new UnknownError(error).toErr();
              }
            }
          }
          if (!confirm(readback.value)) {
            return refusal(
              operation,
              worksheetName,
              `applied, but the readback did not contain the expected ${nodeLabel} — the ` +
                'refinement was not durable. Not retrying; fall back to the standard path.',
            );
          }

          return new Ok({
            refined: true,
            operation,
            worksheetName,
            message: `Applied ${operation} to worksheet "${worksheetName}" and confirmed the ${nodeLabel} on readback.`,
          });
        },
      });
    },
  });

  return refineWorksheetTool;
};
