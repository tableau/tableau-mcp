import { Err, Ok, Result } from 'ts-results-es';

import { log } from '../../logging/logger.js';
import { sanitizeValue } from '../../logging/sanitize.js';
import { ExecuteCommandError, WithExecutorAndAbortSignal } from '../externalApi/executorTypes.js';
import { dashboardFragmentSimpleId } from '../metadata/dashboards.js';
import { normalizeArray, parseXML } from '../metadata/parser.js';
import type { ParsedDashboard } from '../metadata/types.js';
import { classifyWorkbookWorksheets } from '../metadata/worksheetRenderState.js';
import {
  blockingValidationIssues,
  introducedBlockingValidationIssues,
  runValidation,
} from '../validation/registry.js';
import { ValidationIssue } from '../validation/types.js';
import { parsedXmlNamesEqual, xmlNamesEqual } from '../xmlElement.js';
import { type ApplyFocus } from './applyFocus.js';
import { withApplyLock } from './applyMutex.js';
import {
  composeDashboardWorkbook,
  dashboardMembershipMatches,
  dashboardWorksheetNames,
  omitWorkbookActions,
} from './dashboardViewpoints.js';
import { getWorkbookXml } from './getWorkbookXml.js';
import { applyWorkbookText } from './loadWorkbookXml.js';
import {
  applyPreparedSheet,
  type PerSheetApplyOutcome,
  type PerSheetKind,
  preparePerSheetApply,
} from './perSheetDocumentApply.js';
import { pollReadback } from './pollReadback.js';

export type LoadDashboardXmlError =
  | { type: 'invalid-xml' }
  | { type: 'validation-failed'; issues: Array<ValidationIssue> }
  // The caller's dashboard_name disagrees with the `<dashboard name>` in the authored XML, or the
  // payload carries no top-level `<dashboard>` fragment to gate on (e.g. a whole `<workbook>`
  // document). Caught BEFORE apply so the agent gets an actionable message instead of a misleading
  // empty-name mismatch.
  | { type: 'name-mismatch'; message: string }
  // The load-dashboard command reported command-level completion, but Tableau
  // rejected the actual document load (surfaced in the response payload, not in
  // `status`). `message` carries Desktop's own error text.
  | { type: 'load-rejected'; message: string }
  | { type: 'source-drift'; message: string }
  | { type: 'verification-failed'; message: string }
  // Only surfaced when a caller opts in with `requireExistingSheet` (apply-dashboard, apply-storyboard);
  // flag-off callers take the whole-workbook path and never see this (create sheet and apply).
  | { type: 'sheet-absent'; message: string }
  // A dashboard zone references a worksheet that exists by name but has no applied
  // mark/encoding (no visual doc). Desktop's HasVisualDoc would reject this with
  // IDP_ERR_DASHBOARD_MISSING_VISUAL_DOC; we catch it before dispatch. retry-safe: nothing sent.
  | { type: 'sheet-not-rendered'; message: string; worksheetNames: string[] };

export interface LoadDashboardXmlOk {
  appliedName?: string;
  validationWarnings: ValidationIssue[];
}

type LoadDashboardXmlResult = Result<
  LoadDashboardXmlOk,
  | { type: 'execute-command-error'; error: ExecuteCommandError }
  | { type: 'load-dashboard-xml-error'; error: LoadDashboardXmlError }
>;

type LoadDashboardHelperResult = Result<
  void,
  | { type: 'execute-command-error'; error: ExecuteCommandError }
  | { type: 'load-dashboard-xml-error'; error: LoadDashboardXmlError }
>;

/**
 * Canonical-name gate. The `<dashboard name>` in the authored XML is the identity Tableau
 * applies, so require the caller's `dashboardName` to agree with it before we touch Desktop.
 * Names are compared after trim and Unicode NFC normalization (case-sensitive) so visually
 * identical NFD/NFC spellings do not false-mismatch. Returns the validated canonical name — the
 * name exactly as authored in the XML (trimmed), which is what Tableau stores when it applies the
 * raw XML — for the load, and so upsertDashboardIntoWorkbook's own name check still matches.
 *
 * Only a single top-level `<dashboard>` fragment is a legal payload here (the same fragment
 * get-dashboard-xml returns and upsertDashboardIntoWorkbook requires). A `<workbook>`-wrapped document
 * has no top-level identity to gate on, so it is rejected before apply with a recovery hint rather
 * than failing as a misleading mismatch against an empty XML name.
 */
function resolveCanonicalDashboardName(
  dashboardName: string,
  xml: string,
): Result<string, Extract<LoadDashboardXmlError, { type: 'name-mismatch' }>> {
  const callerRef = dashboardName.trim();
  let xmlName = '';
  let xmlId = '';
  let isWorkbookDocument = false;
  try {
    const parsed = parseXML(xml);
    const dashboard = normalizeArray(parsed.dashboard as ParsedDashboard | undefined)[0];
    xmlName = dashboard?.['@_name']?.trim() ?? '';
    xmlId = dashboard?.['simple-id']?.['@_uuid']?.trim() ?? '';
    isWorkbookDocument = !xmlName && Boolean(parsed.workbook);
  } catch {
    xmlName = '';
  }

  if (!xmlName) {
    // No top-level <dashboard> identity to gate on — reject with an actionable recovery message
    // instead of a misleading mismatch against an empty XML name.
    return Err({
      type: 'name-mismatch',
      message: isWorkbookDocument
        ? 'Applying a dashboard needs a single <dashboard name="..."> fragment, but the cached file holds ' +
          `a whole <workbook> document. FIX: read-cached-xml with dashboard="${callerRef}" to pull just ` +
          'that element, write-cached-xml with the same selector to splice your edit back, then apply ' +
          'that file.'
        : 'No top-level <dashboard name="..."> element was found in the cached file. ' +
          `FIX: the file must hold a single <dashboard name="${callerRef}"> fragment. Use read-cached-xml ` +
          'with that dashboard selector to check what the file actually contains.',
    });
  }

  if (!xmlNamesEqual(xmlName, callerRef) && !(xmlId && xmlId === callerRef)) {
    return Err({
      type: 'name-mismatch',
      message:
        `dashboard_name "${dashboardName}" does not match the <dashboard name> in the XML ("${xmlName}")` +
        `${xmlId ? ` or its id ("${xmlId}")` : ''}. FIX: Retry with dashboard_name set to the XML's ` +
        `name "${xmlName}"${xmlId ? ` or id "${xmlId}"` : ''} — or update the <dashboard name> attribute ` +
        `in the XML to "${dashboardName}" if the caller name is intended.`,
    });
  }

  return Ok(xmlName);
}

/**
 * Preflight render guard (pure). A dashboard zone can name a worksheet that exists in the live
 * workbook but has never been rendered (no mark/encoding -- a blank sheet skeleton). Desktop's
 * own HasVisualDoc check rejects that combination only AFTER dispatch
 * (IDP_ERR_DASHBOARD_MISSING_VISUAL_DOC); catching it here keeps the apply retry-safe, since
 * nothing is sent to Tableau.
 *
 * This is a pure function over an ALREADY-FETCHED live workbook snapshot: the caller reads the
 * workbook inside `withApplyLock` and hands the same snapshot both here and to the apply, so the
 * check and the write see one consistent read-modify-write (no read/apply race), and a read
 * failure is the caller's to surface as a retriable error (fail CLOSED) rather than being
 * swallowed here. Only worksheets PRESENT-but-blank are flagged -- absent worksheets are the
 * `sheet-absent` / create path's concern, and this guard must not duplicate that (so it returns
 * `[]` for a zone naming a worksheet missing from the snapshot: nothing to flag here).
 */
function findBlankReferencedWorksheets(dashboardXml: string, liveWorkbookXml: string): string[] {
  const worksheetZoneNames = dashboardWorksheetNames(dashboardXml);
  if (worksheetZoneNames.length === 0) {
    return [];
  }
  const { worksheets } = classifyWorkbookWorksheets(liveWorkbookXml);
  return worksheetZoneNames.filter((name) =>
    worksheets.some(
      (worksheet) => parsedXmlNamesEqual(worksheet.name, name) && worksheet.state === 'blank',
    ),
  );
}

function sheetNotRenderedError(
  canonicalName: string,
  blankNames: string[],
): Extract<LoadDashboardXmlError, { type: 'sheet-not-rendered' }> {
  return {
    type: 'sheet-not-rendered',
    worksheetNames: blankNames,
    message:
      `Dashboard "${canonicalName}" references worksheet(s) ${blankNames.join(', ')} that exist ` +
      'by name but have no applied mark/encoding, so Tableau cannot wire them into a dashboard ' +
      '("no visual representation"). FIX: render each worksheet first (place a field on it with ' +
      'add-field, or apply-worksheet with a filled <table>) so it has a mark, then re-apply the ' +
      'dashboard. No changes were sent to Tableau.',
  };
}

// The render guard needs a live-workbook snapshot to inspect worksheet <table> state. Read it
// under the same apply lock the write uses, evaluate the (pure) guard against that one snapshot,
// and fail CLOSED on a read failure: a transient read error surfaces as a retriable
// execute-command-error rather than silently disabling the protection. Both apply routes call
// this from INSIDE their `withApplyLock` body so the read/check/apply run as one critical section.
//
// Returns the fetched live-workbook snapshot so composition can reuse the guard's snapshot.
// The atomic apply separately checks for drift and reads back the result. Returns `null` WITHOUT reading when the dashboard
// names no worksheet zones -- there is nothing for the guard to check, so a zone-less apply
// (per-sheet or whole-workbook) pays no guard fetch, exactly as before this guard existed.
async function runRenderGuardInLock(
  canonicalName: string,
  dashboardXml: string,
  { executor, signal }: WithExecutorAndAbortSignal,
): Promise<Result<string | null, RenderGuardOrApplyError>> {
  if (dashboardWorksheetNames(dashboardXml).length === 0) {
    return Ok(null);
  }
  const workbookResult = await getWorkbookXml({ executor, signal });
  if (workbookResult.isErr()) {
    return Err({ type: 'execute-command-error', error: workbookResult.error });
  }
  const liveWorkbookXml = workbookResult.value;
  const blankNames = findBlankReferencedWorksheets(dashboardXml, liveWorkbookXml);
  if (blankNames.length > 0) {
    log({
      level: 'error',
      message: 'Dashboard references a blank (unrendered) worksheet -- not sent to Tableau',
      logger: 'dashboardCommands',
      data: { dashboardName: canonicalName, worksheetNames: blankNames },
    });
    return Err({
      type: 'load-dashboard-xml-error',
      error: sheetNotRenderedError(canonicalName, blankNames),
    });
  }
  return Ok(liveWorkbookXml);
}

type RenderGuardOrApplyError =
  | { type: 'execute-command-error'; error: ExecuteCommandError }
  | { type: 'load-dashboard-xml-error'; error: LoadDashboardXmlError };

type LoadDashboardKind = Extract<PerSheetKind, 'dashboard' | 'storyboard'>;

export async function loadDashboardXml({
  dashboardName,
  xml,
  focus,
  executor,
  signal,
  kind = 'dashboard',
  requireExistingSheet = false,
  expectedSourceHash,
}: {
  dashboardName: string;
  xml: string;
  focus: ApplyFocus;
  kind?: LoadDashboardKind;
  // True resolves an existing sheet by id and rejects absent targets. Dashboard membership
  // changes use an atomic workbook apply; ordinary layout/storyboard edits use the per-sheet route.
  // Off/False (build-and-apply-dashboard, apply-dashboard-with-viewpoints): the dashboard may be net-new, so
  // the whole-workbook re-post upserts it (appending when absent). That is the create path.
  requireExistingSheet?: boolean;
  expectedSourceHash?: string;
} & WithExecutorAndAbortSignal): Promise<LoadDashboardXmlResult> {
  xml = xml.trim();
  if (!xml || (!xml.startsWith('<?xml') && !xml.startsWith('<'))) {
    return Err({ type: 'load-dashboard-xml-error', error: { type: 'invalid-xml' } });
  }

  const validation = runValidation(xml, 'dashboard');
  const cachedApply = requireExistingSheet;
  const blockingIssues = cachedApply ? [] : blockingValidationIssues(validation.issues);
  if (blockingIssues.length > 0) {
    log({
      level: 'error',
      message: 'Preflight validation failed — dashboard XML not sent to Tableau',
      logger: 'dashboardCommands',
      data: {
        dashboardName,
        issues: blockingIssues,
        xmlPreview: sanitize(xml),
      },
    });

    return Err({
      type: 'load-dashboard-xml-error',
      error: { type: 'validation-failed', issues: blockingIssues },
    });
  }

  if (validation.issues.length > 0) {
    log({
      level: 'warning',
      message: 'Preflight validation warnings (continuing)',
      logger: 'dashboardCommands',
      data: {
        dashboardName,
        issues: validation.issues,
        xmlPreview: sanitize(xml),
      },
    });
  }

  // Require the caller's dashboard_name to agree with the XML root name before apply, then
  // thread the validated canonical name through the load.
  const canonicalNameResult = resolveCanonicalDashboardName(dashboardName, xml);
  if (canonicalNameResult.isErr()) {
    log({
      level: 'error',
      message: 'dashboard_name does not match the XML dashboard name — not sent to Tableau',
      logger: 'dashboardCommands',
      data: { dashboardName, message: canonicalNameResult.error.message },
    });
    return Err({ type: 'load-dashboard-xml-error', error: canonicalNameResult.error });
  }
  const canonicalName = canonicalNameResult.value;
  const canonicalFocus: ApplyFocus =
    focus.navigate === 'artifact' ? { ...focus, sheetName: canonicalName } : focus;

  // The render guard (a zone naming an existing-but-blank worksheet would be rejected by Desktop's
  // own HasVisualDoc check) reads the live workbook. Run it INSIDE each route's apply lock so the
  // read/check/apply are one critical section (no concurrent render between check and apply) and a
  // read failure fails CLOSED. See {@link runRenderGuardInLock}.
  if (requireExistingSheet) {
    const targetRef = dashboardFragmentSimpleId(xml) ?? canonicalName;
    const perSheetResult = await withApplyLock(
      async (): Promise<Result<PerSheetApplyOutcome, RenderGuardOrApplyError>> => {
        const guard = await runRenderGuardInLock(canonicalName, xml, { executor, signal });
        if (guard.isErr()) {
          return Err(guard.error);
        }
        const prepared = await preparePerSheetApply({
          kind,
          sheetName: targetRef,
          fragmentXml: xml,
          expectedSourceHash,
          validationContext: 'dashboard',
          focus: canonicalFocus,
          executor,
          signal,
        });
        if (prepared.isErr()) return Err({ type: 'execute-command-error', error: prepared.error });
        if (typeof prepared.value !== 'object' || !('status' in prepared.value)) {
          return Ok(prepared.value);
        }
        const checked = prepared.value;
        let liveWorkbookXml = guard.value;
        // Removing the final worksheet also changes membership. The candidate alone
        // contains no worksheet zones in that case, so consult the checked live fragment.
        if (
          kind === 'dashboard' &&
          liveWorkbookXml === null &&
          checked.liveDocumentXml &&
          dashboardWorksheetNames(checked.liveDocumentXml).length > 0
        ) {
          const current = await getWorkbookXml({ executor, signal });
          if (current.isErr()) return Err({ type: 'execute-command-error', error: current.error });
          liveWorkbookXml = current.value;
        }
        if (kind === 'dashboard' && liveWorkbookXml !== null) {
          const names = dashboardWorksheetNames(checked.fragmentXml);
          if (!dashboardMembershipMatches(liveWorkbookXml, checked.name, names)) {
            const applied = await applyDashboardWithViewpointsInLock({
              liveWorkbookXml,
              dashboardName: checked.name,
              xml: checked.fragmentXml,
              focus:
                canonicalFocus.navigate === 'artifact'
                  ? { ...canonicalFocus, sheetName: checked.name }
                  : canonicalFocus,
              executor,
              signal,
            });
            if (applied.isErr()) return applied;
            return Ok({ ...checked, status: 'applied', documentWarnings: [] });
          }
        }
        const applied = await applyPreparedSheet({
          kind,
          prepared: checked,
          focus: canonicalFocus,
          executor,
          signal,
        });
        if (applied.isErr()) {
          return Err({ type: 'execute-command-error', error: applied.error });
        }
        return Ok(applied.value);
      },
    );
    if (perSheetResult.isErr()) {
      // RenderGuardOrApplyError already matches this function's error union (sheet-not-rendered
      // rejection, its retriable read failure, or a per-sheet execute-command error).
      return Err(perSheetResult.error);
    }
    const outcome = perSheetResult.value;
    if (typeof outcome === 'object' && 'status' in outcome) {
      // Preflight warnings ride along so apply responses can compute the host
      // verification receipt without re-running validation.
      return Ok({
        appliedName: outcome.name,
        validationWarnings: validation.issues.filter((issue) => issue.severity !== 'error'),
      });
    }
    if (typeof outcome === 'object' && outcome.type === 'validation-failed') {
      return Err({
        type: 'load-dashboard-xml-error',
        error: { type: 'validation-failed', issues: outcome.issues },
      });
    }
    if (outcome === 'source-drift') {
      return Err({
        type: 'load-dashboard-xml-error',
        error: {
          type: 'source-drift',
          message:
            `The ${kind} changed since this cache was read. Re-read it with get-${kind}-xml, ` +
            `reapply your edit to the new cache file, then retry apply-${kind}. No changes were sent to Tableau.`,
        },
      });
    }
    return Err({
      type: 'load-dashboard-xml-error',
      error: { type: 'sheet-absent', message: sheetAbsentMessage(kind, canonicalName) },
    });
  }

  const result = await loadDashboardXmlViaExternalApi({
    dashboardName: canonicalName,
    xml,
    focus: canonicalFocus,
    executor,
    signal,
  });
  if (result.isErr()) {
    return result;
  }
  // Preflight warnings ride along so apply responses can compute the host
  // verification receipt (W-23447506) without re-running validation.
  return Ok({ appliedName: canonicalName, validationWarnings: validation.issues });
}

/**
 * Apply an edited storyboard in place. A storyboard is a `<dashboard type='storyboard'>`, so this is
 * {@link loadDashboardXml} with the storyboard per-sheet route.
 */
export async function loadStoryboardXml({
  storyboardName,
  xml,
  focus,
  executor,
  signal,
  requireExistingSheet = false,
  expectedSourceHash,
}: {
  storyboardName: string;
  xml: string;
  focus: ApplyFocus;
  requireExistingSheet?: boolean;
  expectedSourceHash?: string;
} & WithExecutorAndAbortSignal): Promise<LoadDashboardXmlResult> {
  return loadDashboardXml({
    dashboardName: storyboardName,
    xml,
    focus,
    executor,
    signal,
    kind: 'storyboard',
    requireExistingSheet,
    expectedSourceHash,
  });
}

async function loadDashboardXmlViaExternalApi({
  dashboardName,
  xml,
  focus,
  executor,
  signal,
}: {
  dashboardName: string;
  xml: string;
  focus: ApplyFocus;
} & WithExecutorAndAbortSignal): Promise<LoadDashboardHelperResult> {
  return withApplyLock(async () => {
    // Run the render guard inside the lock; when it read the live workbook (dashboard names
    // worksheet zones) reuse that single snapshot for the upsert so this route no longer fetches
    // the whole workbook twice. When it short-circuited without reading (no worksheet zones), fetch
    // the snapshot here for the upsert -- still exactly one read on that path.
    const guard = await runRenderGuardInLock(dashboardName, xml, { executor, signal });
    if (guard.isErr()) {
      return Err(guard.error);
    }
    let liveWorkbookXml = guard.value;
    if (liveWorkbookXml === null) {
      const workbookResult = await getWorkbookXml({ executor, signal });
      if (workbookResult.isErr()) {
        return Err({ type: 'execute-command-error', error: workbookResult.error });
      }
      liveWorkbookXml = workbookResult.value;
    }

    const applyResult = await applyDashboardWithViewpointsInLock({
      liveWorkbookXml,
      dashboardName,
      xml,
      focus,
      executor,
      signal,
    });
    if (applyResult.isErr()) return applyResult;

    log({
      level: 'info',
      message: 'load-dashboard completed',
      logger: 'dashboardCommands',
      data: { dashboardName },
    });

    return Ok.EMPTY;
  });
}

/** The caller holds the apply lock for snapshot, validation, atomic write and readback. */
async function applyDashboardWithViewpointsInLock({
  liveWorkbookXml,
  dashboardName,
  xml,
  focus,
  executor,
  signal,
}: {
  liveWorkbookXml: string;
  dashboardName: string;
  xml: string;
  focus: ApplyFocus;
} & WithExecutorAndAbortSignal): Promise<LoadDashboardHelperResult> {
  let workbookDoc: string;
  const names = dashboardWorksheetNames(xml);
  try {
    workbookDoc = composeDashboardWorkbook(liveWorkbookXml, dashboardName, xml);
  } catch (error) {
    return Err({ type: 'execute-command-error', error: { type: 'invalid-response', error } });
  }
  const introduced = introducedBlockingValidationIssues(
    runValidation(liveWorkbookXml, 'workbook').issues,
    runValidation(workbookDoc, 'workbook').issues,
  );
  if (introduced.length > 0)
    return Err({
      type: 'load-dashboard-xml-error',
      error: { type: 'validation-failed', issues: introduced },
    });
  // The mutex coordinates MCP writes; this comparison also catches intervening Desktop edits.
  const current = await getWorkbookXml({ executor, signal });
  if (current.isErr()) return Err({ type: 'execute-command-error', error: current.error });
  if (current.value !== liveWorkbookXml)
    return Err({
      type: 'load-dashboard-xml-error',
      error: {
        type: 'source-drift',
        message:
          'The workbook changed before the dashboard apply. Re-read the dashboard and retry. No changes were sent to Tableau.',
      },
    });
  // Actions are additive on this endpoint, unlike worksheet/dashboard documents. The
  // candidate is validated with its existing actions, but this dashboard-only update
  // leaves those live actions alone rather than appending copies on every layout edit.
  const applied = await applyWorkbookText({
    xml: omitWorkbookActions(workbookDoc),
    focus,
    executor,
    signal,
  });
  if (applied.isErr()) return Err({ type: 'execute-command-error', error: applied.error });
  const readback = await pollReadback({
    read: () => getWorkbookXml({ executor, signal }),
    settled: (value) => dashboardMembershipMatches(value, dashboardName, names),
    signal,
  });
  if (!readback.ok || !readback.settled)
    return Err({
      type: 'load-dashboard-xml-error',
      error: {
        type: 'verification-failed',
        message: `Tableau accepted the dashboard apply, but the worksheet zones and window registrations for "${dashboardName}" could not be verified. Changes may have been applied. Re-read the live dashboard before retrying.`,
      },
    });
  return Ok.EMPTY;
}

function sheetAbsentMessage(kind: LoadDashboardKind, canonicalName: string): string {
  if (kind === 'storyboard') {
    return (
      `No storyboard named "${canonicalName}" is open to update. This updates an existing ` +
      'storyboard in place and does not create one. FIX: verify the storyboard name and that it ' +
      'exists in the open workbook.'
    );
  }
  return (
    `No dashboard named "${canonicalName}" is open to update. This updates an existing dashboard ` +
    'in place and does not create one. FIX: check the name with list-dashboards, or create a new ' +
    'dashboard with run-dashboard-batch.'
  );
}

function sanitize(value: unknown): unknown {
  return sanitizeValue(value, {
    maxStringLength: 500,
    seen: new WeakSet<object>(),
    depth: 0,
  });
}
