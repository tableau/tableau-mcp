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

import { worksheetFragmentSimpleId } from '../../../../desktop/metadata/sheets.js';
import {
  appliedSortByFieldDirection,
  confirmSortByFieldApplied,
  confirmSortDirectionApplied,
  confirmTopNApplied,
  planSortByField,
  planSortDirection,
  planTopN,
  type SortDirection,
  type TopNEnd,
} from '../../../../desktop/refine/refineWorksheet.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { ensureUserNamespace } from '../../../../desktop/templates/injectTemplateCore.js';
import {
  blockingValidationIssues,
  runValidation,
} from '../../../../desktop/validation/registry.js';
import { ValidationIssue } from '../../../../desktop/validation/types.js';
import { getWorksheetXml } from '../../../../desktop/wrappers/getWorksheetXml.js';
import { loadWorksheetXml } from '../../../../desktop/wrappers/loadWorksheetXml.js';
import {
  pollReadback,
  READBACK_POLL_INTERVAL_MS,
  READBACK_POLL_MAX_ATTEMPTS,
} from '../../../../desktop/wrappers/pollReadback.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  GetWorksheetXmlFailedError,
  UnknownError,
  WorksheetXmlLoadFailedError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { DesktopTool } from '../../tool.js';

type RefineOperation = 'top_n' | 'sort_direction' | 'sort_by_field';

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
  session: z.string().optional().describe('Desktop session; omit if one.'),
  worksheetName: z.string().min(1).describe('Worksheet display name.'),
  operation: z.enum(['top_n', 'sort_direction', 'sort_by_field']).describe('Refinement type.'),
  topN: z
    .object({
      n: z.number().int().min(1).max(50).describe('Members to keep (1-50).'),
      end: z.enum(['top', 'bottom']).optional().describe('top/bottom; default top.'),
    })
    .optional()
    .describe('For top_n: Top/Bottom-N.'),
  sortDirection: z
    .object({
      direction: z.enum(['ASC', 'DESC']).describe('Existing-sort direction.'),
    })
    .optional()
    .describe('For sort_direction.'),
  targetField: z
    .string()
    .min(1)
    .optional()
    .describe('sort_by_field axis; omit to auto-detect one categorical axis.'),
  sortByField: z.string().min(1).optional().describe('sort_by_field measure to sort by.'),
  direction: z.enum(['asc', 'desc']).optional().describe('sort_by_field direction; default asc.'),
};

const title = 'Refining worksheet';

export const REFINE_WORKSHEET_DESCRIPTION = 'Refine sheet: top-N/sort/by-field.';

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
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true, // mutates the named worksheet
      idempotentHint: false,
    },
    callback: async (
      {
        session,
        worksheetName,
        operation,
        topN,
        sortDirection,
        targetField,
        sortByField,
        direction,
      },
      extra,
    ): Promise<CallToolResult> => {
      return await refineWorksheetTool.logAndExecute<RefineWorksheetToolResult>({
        extra,
        args: {
          session,
          worksheetName,
          operation,
          topN,
          sortDirection,
          targetField,
          sortByField,
          direction,
        },
        callback: async () => {
          if (!worksheetName || !worksheetName.trim()) {
            return new ArgsValidationError('worksheetName is required.').toErr();
          }

          // Per-operation required params — enforced here (not in the JSON Schema) so the
          // schema stays flat and host-portable, matching add-field's encodingType guard.
          if (operation === 'top_n' && topN === undefined) {
            return new ArgsValidationError('topN is required when operation=top_n.').toErr();
          }
          if (operation === 'sort_direction' && sortDirection === undefined) {
            return new ArgsValidationError(
              'sortDirection is required when operation=sort_direction.',
            ).toErr();
          }
          if (operation === 'sort_by_field' && (!sortByField || !sortByField.trim())) {
            return new ArgsValidationError(
              'sortByField is required when operation=sort_by_field.',
            ).toErr();
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
          const sourceXml = fetched.value.xml;
          const canonicalWorksheetName = fetched.value.name;
          // Read back by the fragment's stable simple-id, not the display name, so a rename between
          // this fetch and the readback can't miss.
          const readbackRef = worksheetFragmentSimpleId(sourceXml) ?? canonicalWorksheetName;

          // 2. Pure minimal patch + the readback confirmation target for this operation.
          let patched: string;
          let confirm: (readback: string) => boolean;
          let nodeLabel: string;
          // For sort_by_field: when the sort node lands but with a DIFFERENT direction than
          // requested (e.g. Desktop silently reverted DESC to ASC), produce a precise refusal
          // instead of the generic "did not contain" async-settle message — a wrong-direction
          // apply must never be reported as success, and the reason must say what went wrong.
          let readbackMiss: ((readback: string) => string | null) | undefined;

          if (operation === 'top_n') {
            const plan = planTopN(sourceXml, {
              n: topN?.n as number,
              end: topN?.end as TopNEnd | undefined,
            });
            if (!plan.ok) {
              return refusal(operation, canonicalWorksheetName, plan.reason);
            }
            patched = plan.xml;
            const col = plan.filterColumn;
            confirm = (rb) => confirmTopNApplied(rb, col);
            nodeLabel = `Top-N filter (function="end") on ${col}`;
          } else if (operation === 'sort_direction') {
            const plan = planSortDirection(sourceXml, {
              direction: sortDirection?.direction as SortDirection,
            });
            if (!plan.ok) {
              return refusal(operation, canonicalWorksheetName, plan.reason);
            }
            patched = plan.xml;
            const col = plan.column;
            const dir = plan.direction;
            confirm = (rb) => confirmSortDirectionApplied(rb, col, dir);
            nodeLabel = `<computed-sort direction="${dir}">${col ? ` on ${col}` : ''}`;
          } else {
            // Accept the model's natural nested shape sortDirection.direction ('ASC'/'DESC')
            // as an alias for the flat lowercase `direction` on sort_by_field. Without this,
            // a call passing only sortDirection silently dropped the requested direction and
            // defaulted to ASC — then falsely confirmed success on the wrong direction. The
            // flat param wins when both are present; the nested alias is normalized to lower.
            const requestedDirection =
              direction ??
              (sortDirection?.direction ? sortDirection.direction.toLowerCase() : undefined);
            const sortByDirection =
              requestedDirection === 'desc'
                ? 'DESC'
                : requestedDirection === 'asc'
                  ? 'ASC'
                  : undefined;
            const plan = planSortByField(sourceXml, {
              targetField,
              sortByField: sortByField as string,
              direction: sortByDirection,
            });
            if (!plan.ok) {
              return refusal(operation, canonicalWorksheetName, plan.reason);
            }
            patched = plan.xml;
            const col = plan.column;
            const using = plan.using;
            const dir = plan.direction;
            confirm = (rb) => confirmSortByFieldApplied(rb, col, using, dir);
            readbackMiss = (rb) => {
              const landed = appliedSortByFieldDirection(rb, col, using);
              return landed !== null && landed !== dir
                ? `applied, but the sort direction is ${landed}, not the requested ${dir} — ` +
                    'Desktop did not honor the direction change. Not retrying; fall back to ' +
                    'the standard path.'
                : null;
            };
            nodeLabel = `<computed-sort direction="${dir}" column="${col}" using="${using}">`;
          }

          // 3. Declare the user: namespace before the patch is parsed/applied.
          const prepared = ensureUserNamespace(patched);

          // 4. Preflight validation — an error-severity issue means we do NOT apply.
          const validation = runValidation(prepared, 'worksheet');
          const blockingIssues = blockingValidationIssues(validation.issues);
          if (blockingIssues.length > 0) {
            return refusal(
              operation,
              canonicalWorksheetName,
              `preflight validation failed — not applying. ${formatValidationErrors(blockingIssues)}`,
            );
          }

          // 5. Apply ONCE through the shared, validated worksheet apply path. On failure:
          // STOP, no retry, no whole-workbook fallback.
          const applied = await loadWorksheetXml({
            worksheetName: canonicalWorksheetName,
            xml: prepared,
            focus: { navigate: 'artifact', sheetName: canonicalWorksheetName },
            executor,
            signal: extra.signal,
            // refine-worksheet only ever edits a sheet it already fetched above, so it replaces an
            // existing worksheet in place via the per-sheet `/document` route — the same route
            // apply-worksheet uses. It never creates a sheet, so it must not take the whole-workbook
            // upsert (create) path. A name that no longer resolves surfaces as an error, not a create.
            requireExistingSheet: true,
            // Refine already ran stricter candidate-only preflight, so an introduced-issue GET is redundant.
            callerPreflightsBlockingIssues: true,
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

          // 6. Read back and confirm the expected node landed durably. The apply is async
          // after SUCCEEDED, so poll rather than trusting one immediate readback — the
          // first read can race the settle and still show pre-apply XML.
          const readback = await pollReadback({
            read: () =>
              getWorksheetXml({
                worksheetName: readbackRef,
                executor,
                signal: extra.signal,
              }),
            settled: (fragment) => confirm(fragment.xml),
            signal: extra.signal,
          });
          if (!readback.ok) {
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
          if (readback.settled) {
            return new Ok({
              refined: true,
              operation,
              worksheetName: canonicalWorksheetName,
              message: `Applied ${operation} to worksheet "${canonicalWorksheetName}" and confirmed the ${nodeLabel} on readback.`,
            });
          }
          const lastReadback = readback.value.xml;

          // The confirm never matched across the full poll budget. If the sort node DID land
          // but with a direction other than requested (Desktop reverted DESC to ASC), report
          // that precisely — the polling above already gave a correct-direction apply every
          // chance to settle, so a mismatch now is durable, not a race.
          const mismatchReason = readbackMiss?.(lastReadback);
          if (mismatchReason) {
            return refusal(operation, canonicalWorksheetName, mismatchReason);
          }

          return refusal(
            operation,
            canonicalWorksheetName,
            `applied, but the readback did not contain the expected ${nodeLabel} after ` +
              `${READBACK_POLL_MAX_ATTEMPTS} polls (${READBACK_POLL_INTERVAL_MS}ms apart) — ` +
              'the refinement was not durable, or this is an async-settle miss. Not retrying ' +
              'further; fall back to the standard path.',
          );
        },
      });
    },
  });

  return refineWorksheetTool;
};
