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
import { setTimeout as setTimeoutPromise } from 'timers/promises';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getWorksheetFragment } from '../../../desktop/commands/workbook/getWorksheetXml.js';
import { loadWorksheetXml } from '../../../desktop/commands/workbook/loadWorksheetXml.js';
import {
  confirmSortByFieldApplied,
  confirmSortDirectionApplied,
  confirmTopNApplied,
  planSortByField,
  planSortDirection,
  planTopN,
  type SortDirection,
  type TopNEnd,
} from '../../../desktop/refine/refineWorksheet.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { ensureUserNamespace } from '../../../desktop/templates/injectTemplateCore.js';
import { blockingValidationIssues, runValidation } from '../../../desktop/validation/registry.js';
import { ValidationIssue } from '../../../desktop/validation/types.js';
import { parseOuterElement } from '../../../desktop/xmlElement.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  GetWorksheetXmlFailedError,
  UnknownError,
  WorksheetXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

type RefineOperation = 'top_n' | 'sort_direction' | 'sort_by_field';

type RefineWorksheetToolResult =
  | { refined: true; operation: RefineOperation; worksheetName: string; message: string }
  | { refined: false; operation: RefineOperation; worksheetName: string; reason: string };

// Commands apply asynchronously after SUCCEEDED (see
// resources/desktop/knowledge/tactics/data/notional-spec-authoring.md) — the apply-once
// call above returning does not mean the patch has landed in Desktop's live document yet.
// A single readback immediately after apply can race that settle and see the PRE-apply
// XML, which would misreport a durable apply as `refined: false`. Poll instead of reading
// once; 250ms intervals are the interval documented to work for this same class of race
// elsewhere (list-worksheets/list-dashboards polling after new-worksheet/new-dashboard).
const READBACK_POLL_MAX_ATTEMPTS = 8;
const READBACK_POLL_INTERVAL_MS = 250;

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
  session: z.string().optional().describe(''),
  worksheetName: z.string().min(1).describe(''),
  operation: z.enum(['top_n', 'sort_direction', 'sort_by_field']).describe(''),
  topN: z
    .object({
      n: z.number().int().min(1).max(50).describe(''),
      end: z.enum(['top', 'bottom']).optional().describe(''),
    })
    .optional()
    .describe(''),
  sortDirection: z
    .object({
      direction: z.enum(['ASC', 'DESC']).describe(''),
    })
    .optional()
    .describe(''),
  targetField: z.string().min(1).optional().describe(''),
  sortByField: z.string().min(1).optional().describe(''),
  direction: z.enum(['asc', 'desc']).optional().describe(''),
};

const title = 'Refine Worksheet';

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
      title,
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

          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);

          // 1. ONE fetch of the target worksheet.
          const fetched = await getWorksheetFragment({
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
          const canonicalWorksheetName =
            parseOuterElement(sourceXml)?.name?.trim() || worksheetName;

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
            const sortByDirection =
              direction === 'desc' ? 'DESC' : direction === 'asc' ? 'ASC' : undefined;
            const plan = planSortByField(sourceXml, {
              targetField: targetField as string,
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

          // 6. Read back and confirm the expected node landed durably. The apply is async
          // after SUCCEEDED, so poll rather than trusting one immediate readback — the
          // first read can race the settle and still show pre-apply XML.
          for (let attempt = 1; attempt <= READBACK_POLL_MAX_ATTEMPTS; attempt++) {
            const readback = await getWorksheetFragment({
              worksheetName: canonicalWorksheetName,
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
            if (confirm(readback.value)) {
              return new Ok({
                refined: true,
                operation,
                worksheetName: canonicalWorksheetName,
                message: `Applied ${operation} to worksheet "${canonicalWorksheetName}" and confirmed the ${nodeLabel} on readback.`,
              });
            }
            if (attempt < READBACK_POLL_MAX_ATTEMPTS) {
              await setTimeoutPromise(READBACK_POLL_INTERVAL_MS, undefined, {
                signal: extra.signal,
              });
            }
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
