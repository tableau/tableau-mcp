import { Err, Ok, Result } from 'ts-results-es';

import { log } from '../../logging/logger.js';
import { sanitizeValue } from '../../logging/sanitize.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
  WorkbookDocument,
} from '../externalApi/executorTypes.js';
import { dashboardFragmentSimpleId } from '../metadata/dashboards.js';
import { normalizeArray, parseXML } from '../metadata/parser.js';
import type { ParsedDashboard } from '../metadata/types.js';
import { classifyWorkbookWorksheets } from '../metadata/worksheetRenderState.js';
import { blockingValidationIssues, runValidation } from '../validation/registry.js';
import { ValidationIssue } from '../validation/types.js';
import { parsedXmlNamesEqual, xmlNamesEqual } from '../xmlElement.js';
import { type ApplyFocus } from './applyFocus.js';
import { withApplyLock } from './applyMutex.js';
import {
  composeDashboardWorkbook,
  createDashboardReadbackVerifier,
  dashboardWorksheetNames,
  omitWorkbookActions,
  unregisteredDashboardWorksheets,
} from './dashboardViewpoints.js';
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
  | { type: 'registration-required'; message: string; worksheetNames: string[] }
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
  /** Worksheet registrations observed in the successful post-apply readback. */
  verifiedWorksheetNames?: string[];
}

type LoadDashboardXmlResult = Result<
  LoadDashboardXmlOk,
  | { type: 'execute-command-error'; error: ExecuteCommandError }
  | { type: 'load-dashboard-xml-error'; error: LoadDashboardXmlError }
>;

type LoadDashboardHelperResult = Result<
  { verifiedWorksheetNames: string[] },
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
 * MCP writes share one snapshot. Desktop user edits are not serialized by this mutex. A read
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
// The create-capable apply separately checks for drift and reads back the result.
// Returns `null` WITHOUT reading when the dashboard
// names no worksheet zones -- there is nothing for the guard to check, so a zone-less apply
// (per-sheet or whole-workbook) pays no guard fetch, exactly as before this guard existed.
async function runRenderGuardInLock(
  canonicalName: string,
  dashboardXml: string,
  { executor, signal }: WithExecutorAndAbortSignal,
): Promise<Result<WorkbookDocument | null, RenderGuardOrApplyError>> {
  if (dashboardWorksheetNames(dashboardXml).length === 0) {
    return Ok(null);
  }
  const workbookResult = await executor.getWorkbookDocument(signal);
  if (workbookResult.isErr()) {
    return Err({ type: 'execute-command-error', error: workbookResult.error });
  }
  const liveWorkbookXml = workbookResult.value.xml;
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
  return Ok(workbookResult.value);
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
  // True resolves an existing sheet by id and uses only its surgical document endpoint.
  // Missing worksheet registrations require native support; never replace the workbook here.
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
  // MCP read/check/apply are one critical section; this does not block Desktop user edits. A
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
        if (kind === 'dashboard' && guard.value !== null) {
          const names = dashboardWorksheetNames(checked.fragmentXml);
          let missing: string[];
          try {
            missing = unregisteredDashboardWorksheets(guard.value.xml, checked.name, names);
          } catch (error) {
            return Err({
              type: 'execute-command-error',
              error: { type: 'invalid-response', error },
            });
          }
          if (missing.length > 0) {
            return Err({
              type: 'load-dashboard-xml-error',
              error: {
                type: 'registration-required',
                worksheetNames: missing,
                message:
                  `Dashboard "${checked.name}" needs worksheet view registrations for ${missing.join(', ')}. ` +
                  'This Desktop API cannot add them through the dashboard-only endpoint, and a whole-workbook replacement could overwrite concurrent edits. ' +
                  'Add the worksheets to this dashboard in Desktop, then re-read the dashboard before retrying the layout edit. ' +
                  'Do not change worksheet zone types or retry with a whole-workbook replacement. No changes were sent to Tableau.',
              },
            });
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
  return Ok({
    appliedName: canonicalName,
    validationWarnings: validation.issues,
    ...result.value,
  });
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
    let snapshot = guard.value;
    if (snapshot === null) {
      const workbookResult = await executor.getWorkbookDocument(signal);
      if (workbookResult.isErr()) {
        return Err({ type: 'execute-command-error', error: workbookResult.error });
      }
      snapshot = workbookResult.value;
    }

    const applyResult = await applyDashboardWithViewpointsInLock({
      liveWorkbookXml: snapshot.xml,
      expectedInstanceId: snapshot.instanceId ?? executor.desktopInstanceId,
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

    return applyResult;
  });
}

/** Legacy create-capable route. The MCP lock does not prevent concurrent Desktop edits. */
async function applyDashboardWithViewpointsInLock({
  liveWorkbookXml,
  expectedInstanceId,
  dashboardName,
  xml,
  focus,
  executor,
  signal,
}: {
  liveWorkbookXml: string;
  expectedInstanceId: string | undefined;
  dashboardName: string;
  xml: string;
  focus: ApplyFocus;
} & WithExecutorAndAbortSignal): Promise<LoadDashboardHelperResult> {
  let workbookDoc: string;
  let matchesReadback: (workbookXml: string) => boolean;
  const names = dashboardWorksheetNames(xml);
  try {
    // The authored fragment was validated above. Only dashboard membership and identity
    // change here; validate those against the same parsed snapshot used for composition.
    // Revalidating unrelated worksheet fields twice makes this lock scale with their schemas.
    const composed = composeDashboardWorkbook(liveWorkbookXml, dashboardName, xml);
    if (composed.isErr()) {
      return Err({
        type: 'load-dashboard-xml-error',
        error: { type: 'validation-failed', issues: composed.error },
      });
    }
    workbookDoc = composed.value.xml;
    matchesReadback = createDashboardReadbackVerifier(workbookDoc, dashboardName);
  } catch (error) {
    return Err({ type: 'execute-command-error', error: { type: 'invalid-response', error } });
  }
  // Best-effort check for edits already visible now; the API has no atomic revision precondition.
  // Existing-sheet callers must use the surgical endpoint instead of this legacy create route.
  const current = await executor.getWorkbookDocument(signal);
  if (current.isErr()) return Err({ type: 'execute-command-error', error: current.error });
  const sameInstance = (document: WorkbookDocument): boolean =>
    expectedInstanceId === undefined ||
    (document.instanceId ?? executor.desktopInstanceId) === expectedInstanceId;
  if (!sameInstance(current.value) || current.value.xml !== liveWorkbookXml)
    return Err({
      type: 'load-dashboard-xml-error',
      error: {
        type: 'source-drift',
        message:
          'The workbook or Desktop instance changed before the dashboard apply. Re-read the dashboard and retry. No changes were sent to Tableau.',
      },
    });
  // Actions are additive on this endpoint, unlike worksheet/dashboard documents.
  // Leave live actions alone rather than appending copies during this dashboard update.
  const applied = await applyWorkbookText({
    xml: omitWorkbookActions(workbookDoc),
    focus,
    executor,
    signal,
    applyOptions: expectedInstanceId ? { expectedInstanceId } : undefined,
  });
  if (applied.isErr()) return Err({ type: 'execute-command-error', error: applied.error });
  const readback = await pollReadback({
    read: () => executor.getWorkbookDocument(signal),
    settled: (value) => sameInstance(value) && matchesReadback(value.xml),
    signal,
  });
  if (!readback.ok || !readback.settled)
    return Err({
      type: 'load-dashboard-xml-error',
      error: {
        type: 'verification-failed',
        message: `Tableau accepted the dashboard apply, but the submitted layout and worksheet view settings for "${dashboardName}" could not be verified on the original Desktop instance. Changes may have been applied. Re-read the live dashboard before retrying; do not blindly repeat the apply.`,
      },
    });
  return Ok({ verifiedWorksheetNames: names });
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
