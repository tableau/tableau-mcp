import { Err, Ok, Result } from 'ts-results-es';

import { log } from '../../logging/logger.js';
import { sanitizeValue } from '../../logging/sanitize.js';
import { supportsDashboardVisualRegistration } from '../externalApi/apiVersion.js';
import {
  ExecuteCommandError,
  type ExecuteCommandWarning,
  WithExecutorAndAbortSignal,
  WorkbookDocument,
} from '../externalApi/executorTypes.js';
import type { WorkbookDiagnostics } from '../externalApi/types.js';
import { dashboardFragmentSimpleId } from '../metadata/dashboards.js';
import { normalizeArray, parseXML } from '../metadata/parser.js';
import type { ParsedDashboard } from '../metadata/types.js';
import {
  alwaysBlockingValidationIssues,
  blockingValidationIssues,
  runValidation,
} from '../validation/registry.js';
import { ValidationIssue } from '../validation/types.js';
import { parsedXmlNamesEqual } from '../xmlElement.js';
import { type ApplyFocus } from './applyFocus.js';
import { withApplyLock } from './applyMutex.js';
import {
  composeDashboardWorkbook,
  createDashboardReadbackVerifier,
  dashboardWorksheetNames,
  unregisteredDashboardWorksheets,
} from './dashboardViewpoints.js';
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
  // All dashboard callers require an existing sheet; no whole-workbook fallback is safe here.
  | { type: 'sheet-absent'; message: string }
  // The Desktop build lacks the per-sheet document endpoint; nothing was sent.
  | { type: 'route-missing'; message: string };

export interface LoadDashboardXmlOk {
  appliedName?: string;
  validationWarnings: ValidationIssue[];
  /** Nodes Desktop dropped from the applied document; empty on a clean apply. */
  documentWarnings: ExecuteCommandWarning[];
  diagnostics?: WorkbookDiagnostics;
  diagnosticsInvalid?: boolean;
  /** Worksheet registrations observed in the successful post-apply readback. */
  verifiedWorksheetNames?: string[];
}

type LoadDashboardXmlResult = Result<
  LoadDashboardXmlOk,
  | { type: 'execute-command-error'; error: ExecuteCommandError }
  | { type: 'load-dashboard-xml-error'; error: LoadDashboardXmlError }
>;

/**
 * Canonical-name gate. The `<dashboard name>` in the authored XML is the identity Tableau
 * applies, so require the caller's `dashboardName` to agree with it before we touch Desktop.
 * Names are compared after trim and Unicode NFC normalization (case-sensitive) so visually
 * identical NFD/NFC spellings do not false-mismatch. Returns the validated canonical name — the
 * name exactly as authored in the XML (trimmed), which is what Tableau stores when it applies the
 * raw XML — for target resolution and readback.
 *
 * Only a single top-level `<dashboard>` fragment is a legal payload here (the same fragment
 * get-dashboard-xml returns). A `<workbook>`-wrapped document
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

  if (!parsedXmlNamesEqual(xmlName, callerRef) && !(xmlId && xmlId === callerRef)) {
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

// Registration checks and readback must share a snapshot read under the apply lock.
// Zone-less cached applies need no snapshot unless the caller requests verification.
async function readDashboardSnapshotInLock(
  dashboardXml: string,
  { executor, signal }: WithExecutorAndAbortSignal,
): Promise<Result<WorkbookDocument | null, SnapshotOrApplyError>> {
  if (dashboardWorksheetNames(dashboardXml).length === 0) {
    return Ok(null);
  }
  const workbookResult = await executor.getWorkbookDocument(signal);
  if (workbookResult.isErr()) {
    return Err({ type: 'execute-command-error', error: workbookResult.error });
  }
  return Ok(workbookResult.value);
}

type SnapshotOrApplyError =
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
  worksheetNames = [],
  verifyReadback = !requireExistingSheet,
}: {
  dashboardName: string;
  xml: string;
  focus: ApplyFocus;
  kind?: LoadDashboardKind;
  // Retained for cached-fragment validation compatibility. Both values now require an
  // existing sheet and use only its surgical document endpoint; neither permits creation.
  requireExistingSheet?: boolean;
  expectedSourceHash?: string;
  // Registrations outside the submitted zones must exist before the write.
  worksheetNames?: string[];
  verifyReadback?: boolean;
} & WithExecutorAndAbortSignal): Promise<LoadDashboardXmlResult> {
  xml = xml.trim();
  if (!xml || (!xml.startsWith('<?xml') && !xml.startsWith('<'))) {
    return Err({ type: 'load-dashboard-xml-error', error: { type: 'invalid-xml' } });
  }

  const validation = runValidation(xml, 'dashboard');
  const cachedApply = requireExistingSheet;
  const blockingIssues = cachedApply
    ? alwaysBlockingValidationIssues(validation.issues)
    : blockingValidationIssues(validation.issues);
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

  // The lock serializes MCP snapshot/check/apply, not Desktop user edits.
  // A snapshot read failure fails closed; no workbook replacement or creation fallback is safe.
  let verifiedWorksheetNames: string[] | undefined;
  const targetRef = dashboardFragmentSimpleId(xml) ?? canonicalName;
  const perSheetResult = await withApplyLock(
    async (): Promise<Result<PerSheetApplyOutcome, SnapshotOrApplyError>> => {
      const workbookSnapshot = await readDashboardSnapshotInLock(xml, { executor, signal });
      if (workbookSnapshot.isErr()) {
        return Err(workbookSnapshot.error);
      }
      let snapshot = workbookSnapshot.value;
      if (snapshot === null && (verifyReadback || worksheetNames.length > 0)) {
        const workbook = await executor.getWorkbookDocument(signal);
        if (workbook.isErr()) return Err({ type: 'execute-command-error', error: workbook.error });
        snapshot = workbook.value;
      }
      const expectedInstanceId = snapshot?.instanceId ?? executor.desktopInstanceId;
      const prepared = await preparePerSheetApply({
        kind,
        sheetName: targetRef,
        fragmentXml: xml,
        expectedSourceHash,
        expectedInstanceId,
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
      const referencedNames = dashboardWorksheetNames(checked.fragmentXml);
      const names = [...new Set([...referencedNames, ...worksheetNames])];
      const supportsRegistration = supportsDashboardVisualRegistration(executor.desktopApiVersion);
      let requiresRegistrationReadback = false;
      if (kind === 'dashboard' && snapshot !== null) {
        let missing: string[];
        try {
          missing = unregisteredDashboardWorksheets(snapshot.xml, checked.name, names);
        } catch (error) {
          return Err({
            type: 'execute-command-error',
            error: { type: 'invalid-response', error },
          });
        }
        requiresRegistrationReadback = supportsRegistration && missing.length > 0;
        if (
          missing.length > 0 &&
          (!supportsRegistration ||
            missing.some(
              (name) =>
                !referencedNames.some((referenced) => parsedXmlNamesEqual(name, referenced)),
            ))
        ) {
          return Err({
            type: 'load-dashboard-xml-error',
            error: {
              type: 'registration-required',
              worksheetNames: missing,
              message:
                `Dashboard "${checked.name}" needs worksheet view registrations for ${missing.join(', ')}. ` +
                (supportsRegistration
                  ? 'Native registration only covers worksheets referenced by the submitted dashboard zones. '
                  : 'This Desktop API cannot add them through the dashboard-only endpoint. ') +
                'A whole-workbook replacement could overwrite concurrent edits. ' +
                'Add the worksheets to this dashboard in Desktop, then re-read the dashboard before retrying the layout edit. ' +
                'Do not change worksheet zone types or retry with a whole-workbook replacement. No changes were sent to Tableau.',
            },
          });
        }
      }
      let matchesReadback: ((workbookXml: string) => boolean) | undefined;
      if ((verifyReadback || requiresRegistrationReadback) && snapshot !== null) {
        try {
          // Compose only an in-memory expectation for readback, never a workbook POST.
          const expected = composeDashboardWorkbook(
            snapshot.xml,
            checked.name,
            checked.fragmentXml,
            { useNativeViewpointDefaults: supportsRegistration },
          );
          if (expected.isErr())
            return Err({
              type: 'load-dashboard-xml-error',
              error: { type: 'validation-failed', issues: expected.error },
            });
          matchesReadback = createDashboardReadbackVerifier(expected.value.xml, checked.name);
        } catch (error) {
          return Err({ type: 'execute-command-error', error: { type: 'invalid-response', error } });
        }
      }
      const applied = await applyPreparedSheet({
        kind,
        prepared: checked,
        expectedInstanceId,
        focus: canonicalFocus,
        executor,
        signal,
      });
      if (applied.isErr()) {
        return Err({ type: 'execute-command-error', error: applied.error });
      }
      if (matchesReadback && typeof applied.value === 'object' && 'status' in applied.value) {
        const matches = matchesReadback;
        const readback = await pollReadback({
          read: () => executor.getWorkbookDocument(signal),
          settled: (value) =>
            (expectedInstanceId === undefined ||
              (value.instanceId ?? executor.desktopInstanceId) === expectedInstanceId) &&
            matches(value.xml) &&
            (kind !== 'dashboard' ||
              unregisteredDashboardWorksheets(value.xml, checked.name, names).length === 0),
          signal,
        });
        if (!readback.ok || !readback.settled)
          return Err({
            type: 'load-dashboard-xml-error',
            error: {
              type: 'verification-failed',
              message: `Tableau accepted the dashboard apply, but the submitted layout and worksheet view settings for "${checked.name}" could not be verified on the original Desktop instance. Changes may have been applied. Re-read the live dashboard before retrying; do not blindly repeat the apply.`,
            },
          });
        verifiedWorksheetNames = names;
      }
      return Ok(applied.value);
    },
  );
  if (perSheetResult.isErr()) {
    return Err(perSheetResult.error);
  }
  const outcome = perSheetResult.value;
  if (typeof outcome === 'object' && 'status' in outcome) {
    // Invariant: a requested readback that did not run is a failure, never an unverified Ok.
    if (verifyReadback && !verifiedWorksheetNames) {
      return Err({
        type: 'load-dashboard-xml-error',
        error: {
          type: 'verification-failed',
          message: `Tableau accepted the ${kind} apply, but no readback ran for "${outcome.name}". Changes may have been applied. Re-read the live ${kind} before retrying; do not blindly repeat the apply.`,
        },
      });
    }
    // Preflight warnings ride along so apply responses can compute the host
    // verification receipt without re-running validation.
    return Ok({
      appliedName: outcome.name,
      validationWarnings: validation.issues.filter((issue) => issue.severity !== 'error'),
      documentWarnings: outcome.documentWarnings,
      ...(outcome.diagnostics ? { diagnostics: outcome.diagnostics } : {}),
      ...(outcome.diagnosticsInvalid ? { diagnosticsInvalid: true } : {}),
      ...(verifiedWorksheetNames ? { verifiedWorksheetNames } : {}),
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
  if (outcome === 'route-missing') {
    return Err({
      type: 'load-dashboard-xml-error',
      error: {
        type: 'route-missing',
        message:
          `This Tableau Desktop build has no per-sheet ${kind} document endpoint, so "${canonicalName}" ` +
          'cannot be updated in place. Update Tableau Desktop. No changes were sent to Tableau.',
      },
    });
  }
  return Err({
    type: 'load-dashboard-xml-error',
    error: { type: 'sheet-absent', message: sheetAbsentMessage(kind, canonicalName) },
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
    'in place and does not create one. FIX: create the dashboard in Desktop and add the referenced ' +
    'worksheets there, then re-read and apply the layout. No changes were sent to Tableau.'
  );
}

function sanitize(value: unknown): unknown {
  return sanitizeValue(value, {
    maxStringLength: 500,
    seen: new WeakSet<object>(),
    depth: 0,
  });
}
