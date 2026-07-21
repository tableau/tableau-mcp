// delete-worksheet — closes the S6 dead-end from the W60 UX audit: "remove a sheet"
// previously had NO tool, so agents hand-edited workbook XML and retry-looped. This
// tool does the removal server-side with the proven node-surgery + refusal patterns:
//  - node surgery mirrors injectTemplateCore.ts's removeSameNamedWorksheet — STRUCTURAL
//    (parse → filter → serialize with the pipeline's own parser.ts pair), never string
//    surgery, so quote style / attribute order / entity encoding cannot defeat the match;
//  - the dashboard-reference guard mirrors that function's member-sheet zone oracle,
//    but walks PER DASHBOARD so the refusal can NAME the referencing dashboards;
//  - empty-container handling mirrors dashboards.ts's deleteDashboard.
// SAFE DEFAULT (v1): a sheet referenced by any dashboard's zones is REFUSED — silently
// deleting a dashboard's member sheet would corrupt the dashboard. No cascade delete.

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { loadWorkbookXml } from '../../../desktop/commands/workbook/loadWorkbookXml.js';
import { normalizeArray, parseXML, serializeXML } from '../../../desktop/metadata/parser.js';
import type {
  ParsedDashboard,
  ParsedWindow,
  ParsedWorkbook,
  ParsedWorksheet,
} from '../../../desktop/metadata/types.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { xmlNamesEqual } from '../../../desktop/xmlElement.js';
import {
  DesktopCommandExecutionError,
  WorkbookXmlLoadFailedError,
  WorksheetNotFoundError,
  XmlModificationError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { DesktopTool } from '../tool.js';

// ── Pure removal core (exported for the fixture tests) ───────────────────────

export type RemoveWorksheetResult =
  | { status: 'removed'; xml: string }
  | { status: 'not-found'; worksheets: string[] }
  | { status: 'last-worksheet' }
  | { status: 'dashboard-referenced'; dashboards: string[] }
  | { status: 'parse-failed'; message: string };

/**
 * True when any `<zone>` element anywhere under `node` carries the sheet name — the
 * same whole-subtree walk as injectTemplateCore.ts's member-sheet oracle
 * (hasZoneNamed), reused here scoped to one dashboard node at a time so nested
 * layout-container zones and story points are all covered.
 */
function subtreeHasZoneNamed(node: unknown, name: string): boolean {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((entry) => subtreeHasZoneNamed(entry, name));
  const record = node as Record<string, unknown>;
  const zones = normalizeArray(record['zone']);
  if (
    zones.some(
      (zone) =>
        !!zone &&
        typeof zone === 'object' &&
        typeof (zone as Record<string, unknown>)['@_name'] === 'string' &&
        xmlNamesEqual((zone as Record<string, string>)['@_name'], name),
    )
  ) {
    return true;
  }
  return Object.values(record).some((value) => subtreeHasZoneNamed(value, name));
}

/** Names of every dashboard whose zone tree references `worksheetName`. */
function dashboardsReferencingSheet(workbook: ParsedWorkbook, worksheetName: string): string[] {
  const dashboards = normalizeArray<ParsedDashboard>(workbook.workbook?.dashboards?.dashboard);
  return dashboards
    .filter((db) => subtreeHasZoneNamed(db, worksheetName))
    .map((db) => db['@_name'])
    .filter((name): name is string => !!name);
}

/**
 * Remove the named worksheet node AND its worksheet-class window entry from the
 * workbook XML. Refuses (without mutating) when the sheet is referenced by any
 * dashboard's zones, is the last remaining worksheet, or does not exist. Dashboard
 * windows sharing the sheet's name are never touched (the `@_class === 'worksheet'`
 * guard, same as removeSameNamedWorksheet).
 */
export function removeWorksheetFromWorkbook(
  workbookXml: string,
  worksheetName: string,
): RemoveWorksheetResult {
  let workbook: ParsedWorkbook;
  try {
    workbook = parseXML(workbookXml);
  } catch (error) {
    return { status: 'parse-failed', message: getExceptionMessage(error) };
  }
  const wb = workbook.workbook;
  const container = wb?.worksheets;
  const worksheets = normalizeArray<ParsedWorksheet>(container?.worksheet);
  const kept = worksheets.filter(
    (ws) => !ws?.['@_name'] || !xmlNamesEqual(ws['@_name'], worksheetName),
  );
  if (!wb || !container || kept.length === worksheets.length) {
    return {
      status: 'not-found',
      worksheets: worksheets.map((ws) => ws?.['@_name']).filter((name): name is string => !!name),
    };
  }
  if (kept.length === 0) {
    return { status: 'last-worksheet' };
  }

  const referencing = dashboardsReferencingSheet(workbook, worksheetName);
  if (referencing.length > 0) {
    return { status: 'dashboard-referenced', dashboards: referencing };
  }
  // Defense-in-depth catch-all (the exact oracle removeSameNamedWorksheet trusts): a
  // zone carrying the name OUTSIDE any named dashboard node still refuses — never
  // strip a sheet we cannot prove unreferenced.
  if (subtreeHasZoneNamed(workbook, worksheetName)) {
    return { status: 'dashboard-referenced', dashboards: [] };
  }

  container.worksheet = kept.length === 1 ? kept[0] : kept;
  const windows = normalizeArray<ParsedWindow>(wb.windows?.window);
  const keptWindows = windows.filter(
    (w) =>
      !(
        w?.['@_class'] === 'worksheet' &&
        w?.['@_name'] &&
        xmlNamesEqual(w['@_name'], worksheetName)
      ),
  );
  if (wb.windows && keptWindows.length !== windows.length) {
    if (keptWindows.length === 0) {
      delete wb.windows.window;
    } else {
      wb.windows.window = keptWindows.length === 1 ? keptWindows[0] : keptWindows;
    }
  }
  return { status: 'removed', xml: serializeXML(workbook) };
}

// ── Tool registration ────────────────────────────────────────────────────────

type DeleteWorksheetRefusalReason =
  | 'dashboard-referenced'
  | 'last-worksheet'
  | 'user-changed-workbook';

type DeleteWorksheetToolResult =
  | { deleted: true; worksheet: string; guidance: string }
  | {
      deleted: false;
      reason: DeleteWorksheetRefusalReason;
      dashboards?: string[];
      guidance: string;
    };

function refusal(
  reason: DeleteWorksheetRefusalReason,
  guidance: string,
  dashboards?: string[],
): Ok<DeleteWorksheetToolResult> {
  return new Ok({ deleted: false, reason, guidance, ...(dashboards ? { dashboards } : {}) });
}

const paramsSchema = {
  session: z.string().optional(),
  worksheetName: z.string().min(1),
};

const title = 'Delete Worksheet';
export const getDeleteWorksheetTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const deleteWorksheetTool = new DesktopTool({
    server,
    name: 'delete-worksheet',
    title,
    description: 'Delete a worksheet safely.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true, // removes a worksheet from the active workbook
      idempotentHint: false, // a second call errors: the sheet is already gone
    },
    callback: async ({ session, worksheetName }, extra): Promise<CallToolResult> => {
      return await deleteWorksheetTool.logAndExecute<DeleteWorksheetToolResult>({
        extra,
        args: { session, worksheetName },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);

          // ── Events anchor (pre-read) — the standard gate (bindTemplate.ts /
          // dashboardAutoApply.ts): capture BEFORE the read so the (read, apply]
          // window is checkable. Best-effort: a transport without event support
          // proceeds without the gate.
          let eventsAnchor: number | undefined;
          const anchor = await executor.getEvents({ signal: extra.signal });
          if (anchor.isOk()) {
            eventsAnchor = anchor.value.latest_sequence;
          }

          const xmlResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (xmlResult.isErr()) {
            return new DesktopCommandExecutionError(xmlResult.error).toErr();
          }

          const removal = removeWorksheetFromWorkbook(xmlResult.value, worksheetName);
          if (removal.status === 'parse-failed') {
            return new XmlModificationError(
              `Could not parse the live workbook structure: ${removal.message}`,
            ).toErr();
          }
          if (removal.status === 'not-found') {
            return new WorksheetNotFoundError(
              [
                `Worksheet "${worksheetName}" was not found in the workbook.`,
                removal.worksheets.length > 0
                  ? `Existing worksheets: ${removal.worksheets.map((n) => `"${n}"`).join(', ')}.`
                  : 'The workbook has no worksheets.',
                'Use list-worksheets to see the current sheet names.',
              ].join(' '),
            ).toErr();
          }
          if (removal.status === 'last-worksheet') {
            return refusal(
              'last-worksheet',
              `Refused: "${worksheetName}" is the only worksheet in the workbook and Tableau ` +
                'workbooks must keep at least one sheet. Create or inject another worksheet ' +
                'first, then delete this one. Nothing was applied.',
            );
          }
          if (removal.status === 'dashboard-referenced') {
            const named =
              removal.dashboards.length > 0
                ? `dashboard(s) ${removal.dashboards.map((d) => `"${d}"`).join(', ')}`
                : 'a dashboard/story zone that could not be attributed to a named dashboard';
            return refusal(
              'dashboard-referenced',
              `Refused: worksheet "${worksheetName}" is referenced by ${named}. Deleting it ` +
                'would corrupt those dashboards, and there is no cascade delete. Remove the ' +
                "sheet's zone from each referencing dashboard first (build-and-apply-dashboard " +
                'or apply-dashboard with updated zones), or delete the dashboard, then retry. ' +
                'Nothing was applied.',
              removal.dashboards,
            );
          }

          // ── Events re-check pre-dispatch: a user edit after our read means the
          // removal was computed against a stale workbook — applying it would silently
          // revert their changes. Refuse; a re-run reads fresh.
          if (eventsAnchor !== undefined) {
            const events = await executor.getEvents({
              signal: extra.signal,
              sinceSequence: eventsAnchor,
            });
            if (events.isOk() && events.value.count > 0) {
              return refusal(
                'user-changed-workbook',
                `Refused: the user changed the workbook after it was read (${events.value.count} ` +
                  'event(s) since read). Re-run delete-worksheet so it reads the current ' +
                  'workbook. Nothing was applied.',
              );
            }
          }

          // ── SAME validated apply path as every apply tool (runValidation preflight
          // inside loadWorkbookXml before dispatch).
          const applyResult = await loadWorkbookXml({
            xml: removal.xml,
            executor,
            signal: extra.signal,
          });
          if (applyResult.isErr()) {
            const { type, error } = applyResult.error;
            switch (type) {
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              case 'load-workbook-xml-error':
                return new WorkbookXmlLoadFailedError(error).toErr();
              default: {
                const _: never = type;
              }
            }
          }

          return new Ok({
            deleted: true,
            worksheet: worksheetName,
            guidance:
              `Deleted worksheet "${worksheetName}" (worksheet node + window entry) from the ` +
              'live workbook.',
          });
        },
      });
    },
  });

  return deleteWorksheetTool;
};
