import { Err, Ok, Result } from 'ts-results-es';

import { log } from '../../logging/logger.js';
import { sanitizeValue } from '../../logging/sanitize.js';
import { ExecuteCommandError, WithExecutorAndAbortSignal } from '../externalApi/executorTypes.js';
import { dashboardFragmentSimpleId, upsertDashboardIntoWorkbook } from '../metadata/dashboards.js';
import { normalizeArray, parseXML } from '../metadata/parser.js';
import type { ParsedDashboard } from '../metadata/types.js';
import { blockingValidationIssues, runValidation } from '../validation/registry.js';
import { ValidationIssue } from '../validation/types.js';
import { xmlNamesEqual } from '../xmlElement.js';
import { type ApplyFocus } from './applyFocus.js';
import { withApplyLock } from './applyMutex.js';
import { getWorkbookXml } from './getWorkbookXml.js';
import { applyWorkbookText } from './loadWorkbookXml.js';
import { type PerSheetKind, tryApplyViaPerSheetRoute } from './perSheetDocumentApply.js';

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
  // Only surfaced when a caller opts in with `requireExistingSheet` (apply-dashboard, apply-storyboard);
  // flag-off callers take the whole-workbook path and never see this (create sheet and apply).
  | { type: 'sheet-absent'; message: string };

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
  // Picks the External Client API call this apply uses.
  // On/True (apply-dashboard, apply-storyboard): replace an existing dashboard/storyboard by id via the
  // per-sheet `/document` route, leaving other sheets untouched. That route is replace-only, so a name
  // that resolves to no live sheet surfaces a `sheet-absent` error instead of creating one.
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

  if (requireExistingSheet) {
    const targetRef = dashboardFragmentSimpleId(xml) ?? canonicalName;
    const perSheetResult = await withApplyLock(() =>
      tryApplyViaPerSheetRoute({
        kind,
        sheetName: targetRef,
        fragmentXml: xml,
        expectedSourceHash,
        validationContext: cachedApply ? 'dashboard' : undefined,
        focus: canonicalFocus,
        executor,
        signal,
      }),
    );
    if (perSheetResult.isErr()) {
      return Err({ type: 'execute-command-error', error: perSheetResult.error });
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
    const workbookResult = await getWorkbookXml({ executor, signal });
    if (workbookResult.isErr()) {
      return Err({ type: 'execute-command-error', error: workbookResult.error });
    }

    let workbookDoc: string;
    try {
      workbookDoc = upsertDashboardIntoWorkbook(workbookResult.value, dashboardName, xml);
    } catch (error) {
      return Err({ type: 'execute-command-error', error: { type: 'invalid-response', error } });
    }

    const applyResult = await applyWorkbookText({ xml: workbookDoc, focus, executor, signal });
    if (applyResult.isErr()) {
      return Err({ type: 'execute-command-error', error: applyResult.error });
    }

    log({
      level: 'info',
      message: 'load-dashboard completed',
      logger: 'dashboardCommands',
      data: { dashboardName },
    });

    return Ok.EMPTY;
  });
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
