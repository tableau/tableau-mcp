import { Err, Ok, Result } from 'ts-results-es';

import { log } from '../../logging/logger.js';
import { sanitizeValue } from '../../logging/sanitize.js';
import { ExecuteCommandError, WithExecutorAndAbortSignal } from '../externalApi/executorTypes.js';
import { normalizeArray, parseXML } from '../metadata/parser.js';
import {
  extractSheetXml,
  upsertSheetIntoWorkbook,
  upsertWorksheetAndWindowIntoWorkbook,
  worksheetFragmentSimpleId,
} from '../metadata/sheets.js';
import {
  compareTargetWorksheetState,
  type TargetWorksheetState,
} from '../metadata/targetWorksheetState.js';
import type { ParsedWorksheet } from '../metadata/types.js';
import {
  formatReadbackVerificationError,
  type ReadbackFinding,
  type ReadbackVerificationResult,
  verifyWorksheetReadback,
} from '../validation/readback-verify.js';
import {
  blockingValidationIssues,
  introducedBlockingValidationIssues,
  runValidation,
} from '../validation/registry.js';
import { ValidationIssue } from '../validation/types.js';
import { xmlNamesEqual } from '../xmlElement.js';
import { type ApplyFocus } from './applyFocus.js';
import { withApplyLock } from './applyMutex.js';
import { getWorkbookXml } from './getWorkbookXml.js';
import { getWorksheetXml } from './getWorksheetXml.js';
import { applyWorkbookText } from './loadWorkbookXml.js';
import { tryApplyViaPerSheetRoute } from './perSheetDocumentApply.js';
import { pollReadback } from './pollReadback.js';

export type LoadWorksheetXmlError =
  | { type: 'invalid-xml' }
  | { type: 'validation-failed'; issues: Array<ValidationIssue> }
  // The caller's worksheet_name disagrees with the `<worksheet name>` in the authored XML, or the
  // payload carries no top-level `<worksheet>` fragment to gate on (e.g. a whole `<workbook>`
  // document). Caught BEFORE apply so the agent gets an actionable message instead of a misleading
  // empty-name mismatch.
  | { type: 'name-mismatch'; message: string }
  // The load-worksheet command reported command-level completion, but Tableau
  // rejected the actual document load (surfaced in the response payload, not in
  // `status`). `message` carries Desktop's own error text.
  | { type: 'load-rejected'; message: string }
  // Apply succeeded but the post-apply readback proved Tableau silently dropped or
  // changed an intent-bearing node (the silently-dropped-pill killer, W4). `message`
  // carries the agent-facing fix recipe; `findings` the structured evidence.
  | { type: 'readback-failed'; findings: ReadbackFinding[]; message: string }
  | { type: 'source-drift'; message: string }
  // Only surfaced when a caller opts in with `requireExistingSheet` (apply-worksheet);
  // flag-off callers take the whole-workbook path and never see this (create sheet and apply).
  | { type: 'sheet-absent'; message: string }
  | { type: 'artifact-drift'; message: string };

/** Non-fatal readback warnings surfaced on a successful apply (sort drops/changes). */
export interface LoadWorksheetXmlOk {
  appliedName?: string;
  readbackWarnings: ReadbackFinding[];
  readbackVerification?: ReadbackVerificationResult;
  validationWarnings?: ValidationIssue[];
}

export interface PostApplyWorksheetReadbackVerification extends ReadbackVerificationResult {
  findings: ReadbackFinding[];
}

export interface ArtifactWorksheetApplyOptions {
  windowXml: string;
  expectedTargetState: TargetWorksheetState;
  expectedInstanceId: string;
  dispatchState: { attempted: boolean };
}

type LoadWorksheetXmlResult = Result<
  LoadWorksheetXmlOk,
  | { type: 'execute-command-error'; error: ExecuteCommandError }
  | { type: 'load-worksheet-xml-error'; error: LoadWorksheetXmlError }
>;

/**
 * Post-apply readback verification. Re-reads the just-applied worksheet and compares
 * intent-bearing structures against the authored XML. Never throws and never fails the
 * apply on a re-read miss: if the worksheet cannot be re-read, verification is skipped
 * (returns no findings) so telemetry can never mask a real apply.
 */
export function publicReadbackVerificationResult(
  result: PostApplyWorksheetReadbackVerification,
): ReadbackVerificationResult {
  return result.message
    ? { ok: result.ok, status: result.status, message: result.message }
    : { ok: result.ok, status: result.status };
}

/**
 * Exported so the whole-workbook apply paths can run the SAME verification. bind-template
 * applies through loadWorkbookXml, which has no readback: when Tableau stripped a requested
 * encoding out of a bind, the response looked exactly like a bind it kept whole, because
 * "Applied" only ever meant "Desktop accepted a document". One helper, both paths.
 */
export async function verifyPostApplyWorksheetReadback(
  worksheetName: string,
  intendedXml: string,
  executor: WithExecutorAndAbortSignal['executor'],
  signal: WithExecutorAndAbortSignal['signal'],
): Promise<PostApplyWorksheetReadbackVerification> {
  try {
    // The apply lands asynchronously, so a re-read that looks like it dropped a node might just be
    // the pre-apply worksheet — poll rather than trust the first read.
    const polled = await pollReadback({
      read: () => getWorksheetXml({ worksheetName, executor, signal }),
      settled: (fragment) =>
        !verifyWorksheetReadback(intendedXml, fragment.xml).some((f) => f.severity === 'error'),
      signal,
    });

    if (!polled.ok) {
      const message =
        polled.error.type === 'get-worksheet-xml-error'
          ? polled.error.error.message
          : 'could not re-read worksheet after apply';
      log({
        level: 'warning',
        message: 'Post-apply worksheet readback verification skipped — could not re-read worksheet',
        logger: 'worksheetCommands',
        data: { worksheetName, status: 'skipped', error: polled.error },
      });
      return { ok: true, status: 'skipped', findings: [], message };
    }

    const findings = verifyWorksheetReadback(intendedXml, polled.value.xml);
    if (findings.some((f) => f.severity === 'error')) {
      return { ok: false, status: 'failed', findings };
    }
    if (findings.some((f) => f.severity === 'warning')) {
      return { ok: true, status: 'warning', findings };
    }
    return { ok: true, status: 'passed', findings: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log({
      level: 'warning',
      message: 'Post-apply worksheet readback verification skipped — re-read threw',
      logger: 'worksheetCommands',
      data: { worksheetName, status: 'skipped', error: message },
    });
    return { ok: true, status: 'skipped', findings: [], message };
  }
}

async function verifyPostApplyArtifactReadback(
  worksheetName: string,
  intendedXml: string,
  executor: WithExecutorAndAbortSignal['executor'],
  signal: WithExecutorAndAbortSignal['signal'],
): Promise<PostApplyWorksheetReadbackVerification> {
  try {
    const polled = await pollReadback({
      read: () => getWorkbookXml({ executor, signal }),
      settled: (workbookXml) => {
        const fragment = extractSheetXml(workbookXml, worksheetName);
        return (
          fragment !== null &&
          !verifyWorksheetReadback(intendedXml, fragment).some(
            (finding) => finding.severity === 'error',
          )
        );
      },
      signal,
    });
    if (!polled.ok) {
      return {
        ok: true,
        status: 'skipped',
        findings: [],
        message: 'could not re-read the latest workbook after apply',
      };
    }

    const fragment = extractSheetXml(polled.value, worksheetName);
    if (fragment === null) {
      return {
        ok: false,
        status: 'failed',
        findings: [],
        message: `Worksheet "${worksheetName}" was absent from the post-apply workbook readback.`,
      };
    }
    const findings = verifyWorksheetReadback(intendedXml, fragment);
    if (findings.some((finding) => finding.severity === 'error')) {
      return { ok: false, status: 'failed', findings };
    }
    if (findings.some((finding) => finding.severity === 'warning')) {
      return { ok: true, status: 'warning', findings };
    }
    return { ok: true, status: 'passed', findings: [] };
  } catch (error) {
    return {
      ok: true,
      status: 'skipped',
      findings: [],
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Turn readback findings into a load outcome: ERROR-severity findings fail the apply
 * (the rendered chart does not match intent), WARNING-severity findings ride along on a
 * successful Ok so the tool can surface them without blocking.
 */
function readbackOutcome(
  verification: PostApplyWorksheetReadbackVerification,
): LoadWorksheetXmlResult {
  const { findings } = verification;
  const errors = findings.filter((f) => f.severity === 'error');
  if (errors.length > 0) {
    return Err({
      type: 'load-worksheet-xml-error',
      error: {
        type: 'readback-failed',
        findings,
        message: formatReadbackVerificationError(findings),
      },
    });
  }
  return Ok({
    readbackWarnings: findings,
    readbackVerification: publicReadbackVerificationResult(verification),
  });
}

/**
 * Canonical-name gate. When the caller provides `worksheetName`, require it to identify the authored
 * fragment — matching either its stable id (the `<simple-id uuid>`, the External Client API worksheet
 * id) or its `<worksheet name>` — before we touch Desktop. When omitted, adopt the fragment's name.
 * Names are compared after trim and Unicode NFC normalization (case-sensitive) so visually identical
 * NFD/NFC spellings do not false-mismatch.
 * Returns the fragment's name exactly as authored (trimmed) — the identity Tableau stores when it
 * applies the raw XML, and what upsertSheetIntoWorkbook's own name check matches.
 *
 * Only a single top-level `<worksheet>` fragment is a legal payload here (the same fragment
 * get-worksheet-xml returns and upsertSheetIntoWorkbook requires). A `<workbook>`-wrapped document has
 * no top-level identity to gate on, so it is rejected before apply with a recovery hint rather than
 * failing as a misleading mismatch against an empty XML name.
 */
export function resolveCanonicalWorksheetName(
  worksheetName: string | undefined,
  xml: string,
): Result<string, Extract<LoadWorksheetXmlError, { type: 'name-mismatch' }>> {
  const callerRef = worksheetName?.trim() ?? '';
  let xmlName = '';
  let xmlId = '';
  let isWorkbookDocument = false;
  try {
    const parsed = parseXML(xml);
    const worksheet = normalizeArray(parsed.worksheet as ParsedWorksheet | undefined)[0];
    xmlName = worksheet?.['@_name']?.trim() ?? '';
    xmlId = worksheet?.['simple-id']?.['@_uuid']?.trim() ?? '';
    isWorkbookDocument = !xmlName && Boolean(parsed.workbook);
  } catch {
    xmlName = '';
  }

  if (!xmlName) {
    // No top-level <worksheet> identity to gate on — reject with an actionable recovery message
    // instead of a misleading mismatch against an empty XML name.
    return Err({
      type: 'name-mismatch',
      message: isWorkbookDocument
        ? 'apply-worksheet expects a single <worksheet name="..."> fragment, but the cached file ' +
          `holds a whole <workbook> document. FIX: read-cached-xml with worksheet="${callerRef}" to pull ` +
          'just that element, write-cached-xml with the same selector to splice your edit back, then ' +
          'apply-worksheet with that file.'
        : 'apply-worksheet could not find a top-level <worksheet name="..."> element in the cached file. ' +
          `FIX: get-worksheet-xml for "${callerRef}" mints a file holding exactly that fragment; edit it ` +
          'with read-cached-xml/write-cached-xml and pass that path to apply-worksheet.',
    });
  }

  if (!callerRef) {
    return Ok(xmlName);
  }

  if (!xmlNamesEqual(xmlName, callerRef) && !(xmlId && xmlId === callerRef)) {
    return Err({
      type: 'name-mismatch',
      message:
        `worksheet_name "${worksheetName}" does not match the <worksheet name> in the XML ("${xmlName}")` +
        `${xmlId ? ` or its id ("${xmlId}")` : ''}. FIX: Retry with worksheet_name set to the XML's name ` +
        `"${xmlName}"${xmlId ? ` or id "${xmlId}"` : ''} — or update the <worksheet name> attribute in the ` +
        `XML to "${worksheetName}" if the caller name is intended.`,
    });
  }

  return Ok(xmlName);
}
function worksheetAbsentMessage(canonicalName: string): string {
  return (
    `No worksheet named "${canonicalName}" is open to update. This updates an existing worksheet ` +
    'in place and does not create one. FIX: check the name with list-worksheets, or create a new ' +
    'worksheet with build-worksheets-from-templates and apply-worksheet.'
  );
}

export async function loadWorksheetXml({
  worksheetName,
  xml,
  focus,
  executor,
  signal,
  readbackVerificationOut,
  requireExistingSheet = false,
  artifactApply,
  expectedSourceHash,
  callerPreflightsBlockingIssues = false,
}: {
  worksheetName: string;
  xml: string;
  focus: ApplyFocus;
  readbackVerificationOut?: ReadbackVerificationResult[];
  // Picks the External Client API call this apply uses.
  // On (apply-worksheet): replace an existing worksheet by id via the per-sheet `/document` route,
  // leaving other sheets untouched. That route is replace-only, so a name that resolves to no live
  // worksheet surfaces a `sheet-absent` error instead of creating one.
  // Off (legacy whole-workbook builders, refine-worksheet): the worksheet may be net-new, so the
  // whole-workbook re-post upserts it (appending when absent). That is the create path.
  requireExistingSheet?: boolean;
  artifactApply?: ArtifactWorksheetApplyOptions;
  expectedSourceHash?: string;
  callerPreflightsBlockingIssues?: boolean;
} & WithExecutorAndAbortSignal): Promise<LoadWorksheetXmlResult> {
  xml = xml.trim();
  if (!xml || (!xml.startsWith('<?xml') && !xml.startsWith('<'))) {
    return Err({ type: 'load-worksheet-xml-error', error: { type: 'invalid-xml' } });
  }

  const validation = runValidation(xml, 'worksheet');
  const cachedApply = requireExistingSheet;
  const blockingIssues = cachedApply ? [] : blockingValidationIssues(validation.issues);
  if (blockingIssues.length > 0) {
    log({
      level: 'error',
      message: 'Preflight validation failed — worksheet XML not sent to Tableau',
      logger: 'worksheetCommands',
      data: {
        worksheetName,
        issues: blockingIssues,
        xmlPreview: sanitize(xml),
      },
    });

    return Err({
      type: 'load-worksheet-xml-error',
      error: { type: 'validation-failed', issues: blockingIssues },
    });
  }

  if (validation.issues.length > 0) {
    log({
      level: 'warning',
      message: 'Preflight validation warnings (continuing)',
      logger: 'worksheetCommands',
      data: {
        worksheetName,
        issues: validation.issues,
        xmlPreview: sanitize(xml),
      },
    });
  }

  // Require the caller's worksheet_name to agree with the XML root name before apply, then
  // thread the validated canonical name through the load and readback.
  const canonicalNameResult = resolveCanonicalWorksheetName(worksheetName, xml);
  if (canonicalNameResult.isErr()) {
    log({
      level: 'error',
      message: 'worksheet_name does not match the XML worksheet name — not sent to Tableau',
      logger: 'worksheetCommands',
      data: { worksheetName, message: canonicalNameResult.error.message },
    });
    return Err({ type: 'load-worksheet-xml-error', error: canonicalNameResult.error });
  }
  const canonicalName = canonicalNameResult.value;
  const canonicalFocus: ApplyFocus =
    focus.navigate === 'artifact' ? { ...focus, sheetName: canonicalName } : focus;

  if (artifactApply) {
    return withApplyLock(async (): Promise<LoadWorksheetXmlResult> => {
      const workbookResult = await getWorkbookXml({ executor, signal });
      if (workbookResult.isErr()) {
        return Err({ type: 'execute-command-error', error: workbookResult.error });
      }

      const drift = compareTargetWorksheetState(
        artifactApply.expectedTargetState,
        workbookResult.value,
        xml,
      );
      if (!drift.ok) {
        return Err({
          type: 'load-worksheet-xml-error',
          error: {
            type: 'artifact-drift',
            message: `The target changed after this artifact was built (${drift.reasons.join(', ')}). Build a fresh artifact from the current workbook.`,
          },
        });
      }

      const baselineValidation = runValidation(workbookResult.value, 'workbook');

      let workbookDoc: string;
      try {
        workbookDoc = upsertWorksheetAndWindowIntoWorkbook(
          workbookResult.value,
          canonicalName,
          xml,
          artifactApply.windowXml,
        );
      } catch (error) {
        return Err({ type: 'execute-command-error', error: { type: 'invalid-response', error } });
      }

      const workbookValidation = runValidation(workbookDoc, 'workbook');
      const workbookBlockingIssues = introducedBlockingValidationIssues(
        baselineValidation.issues,
        workbookValidation.issues,
      );
      if (workbookBlockingIssues.length > 0) {
        return Err({
          type: 'load-worksheet-xml-error',
          error: { type: 'validation-failed', issues: workbookBlockingIssues },
        });
      }

      const applyResult = await applyWorkbookText({
        xml: workbookDoc,
        focus: canonicalFocus,
        executor,
        signal,
        applyOptions: {
          expectedInstanceId: artifactApply.expectedInstanceId,
          onDispatch: () => {
            artifactApply.dispatchState.attempted = true;
          },
        },
      });
      if (applyResult.isErr()) {
        return Err({ type: 'execute-command-error', error: applyResult.error });
      }

      const verification = await verifyPostApplyArtifactReadback(
        canonicalName,
        xml,
        executor,
        signal,
      );
      readbackVerificationOut?.push(publicReadbackVerificationResult(verification));
      return Ok({
        appliedName: canonicalName,
        readbackWarnings: verification.findings,
        readbackVerification: publicReadbackVerificationResult(verification),
        validationWarnings: [...validation.issues, ...workbookValidation.issues],
      });
    });
  }

  if (requireExistingSheet) {
    return withApplyLock(async (): Promise<LoadWorksheetXmlResult> => {
      // Target the live sheet by the fragment's own simple-id (its External Client API worksheet
      // id) so the apply lands on the right sheet even if it was renamed after the fragment was
      // read; fall back to the name only when the fragment carries no id.
      const targetRef = worksheetFragmentSimpleId(xml) ?? canonicalName;
      const outcome = await tryApplyViaPerSheetRoute({
        kind: 'worksheet',
        sheetName: targetRef,
        fragmentXml: xml,
        expectedSourceHash,
        validationContext: cachedApply && !callerPreflightsBlockingIssues ? 'worksheet' : undefined,
        focus: canonicalFocus,
        executor,
        signal,
      });
      if (outcome.isErr()) {
        return Err({ type: 'execute-command-error', error: outcome.error });
      }
      const applyOutcome = outcome.value;
      if (typeof applyOutcome === 'object' && 'status' in applyOutcome) {
        const verification = await verifyPostApplyWorksheetReadback(
          applyOutcome.id,
          applyOutcome.fragmentXml,
          executor,
          signal,
        );
        readbackVerificationOut?.push(publicReadbackVerificationResult(verification));
        const outcomeResult = readbackOutcome(verification);
        if (outcomeResult.isErr()) {
          return outcomeResult;
        }
        // Preflight warnings ride along so apply responses can compute the host
        // verification receipt without re-running validation.
        return Ok({
          ...outcomeResult.value,
          appliedName: applyOutcome.name,
          validationWarnings: validation.issues.filter((issue) => issue.severity !== 'error'),
        });
      }
      if (typeof applyOutcome === 'object') {
        return Err({
          type: 'load-worksheet-xml-error',
          error: { type: 'validation-failed', issues: applyOutcome.issues },
        });
      }
      if (applyOutcome === 'source-drift') {
        return Err({
          type: 'load-worksheet-xml-error',
          error: {
            type: 'source-drift',
            message:
              'The worksheet changed since this cache was read. Re-read it with get-worksheet-xml, reapply your edit to the new cache file, then retry apply-worksheet. No changes were sent to Tableau.',
          },
        });
      }
      return Err({
        type: 'load-worksheet-xml-error',
        error: { type: 'sheet-absent', message: worksheetAbsentMessage(canonicalName) },
      });
    });
  }

  const result = await loadWorksheetXmlViaExternalApi({
    worksheetName: canonicalName,
    xml,
    focus: canonicalFocus,
    executor,
    signal,
    readbackVerificationOut,
  });
  if (result.isErr()) {
    return result;
  }
  // Preflight warnings ride along so apply responses can compute the host
  // verification receipt (W-23447506) without re-running validation.
  return Ok({
    ...result.value,
    appliedName: canonicalName,
    validationWarnings: validation.issues,
  });
}

async function loadWorksheetXmlViaExternalApi({
  worksheetName,
  xml,
  focus,
  executor,
  signal,
  readbackVerificationOut,
}: {
  worksheetName: string;
  xml: string;
  focus: ApplyFocus;
  readbackVerificationOut?: ReadbackVerificationResult[];
} & WithExecutorAndAbortSignal): Promise<LoadWorksheetXmlResult> {
  return withApplyLock(async () => {
    const workbookResult = await getWorkbookXml({ executor, signal });
    if (workbookResult.isErr()) {
      return Err({ type: 'execute-command-error', error: workbookResult.error });
    }

    let workbookDoc: string;
    try {
      workbookDoc = upsertSheetIntoWorkbook(workbookResult.value, worksheetName, xml);
    } catch (error) {
      return Err({ type: 'execute-command-error', error: { type: 'invalid-response', error } });
    }

    const workbookDocValidation = runValidation(workbookDoc, 'workbook');
    const workbookBlockingIssues = blockingValidationIssues(workbookDocValidation.issues);
    if (workbookBlockingIssues.length > 0) {
      log({
        level: 'error',
        message:
          'Constructed worksheet apply document failed workbook validation — XML not sent to Tableau',
        logger: 'worksheetCommands',
        data: {
          worksheetName,
          issues: workbookBlockingIssues,
          xmlPreview: sanitize(workbookDoc),
        },
      });

      return Err({
        type: 'load-worksheet-xml-error',
        error: { type: 'validation-failed', issues: workbookBlockingIssues },
      });
    }

    // Non-blocking findings from the CONSTRUCTED workbook (e.g. a parameter that
    // only exists in workbook context) never appear in the fragment's warning
    // ride-along — log them so receipts/diagnostics can still find them.
    const workbookWarningIssues = workbookDocValidation.issues.filter(
      (issue) => issue.severity !== 'error',
    );
    if (workbookWarningIssues.length > 0) {
      log({
        level: 'warning',
        message: 'Constructed worksheet apply document has non-blocking validation findings',
        logger: 'worksheetCommands',
        data: {
          worksheetName,
          warningCount: workbookWarningIssues.length,
          // Capped + sanitized: validation messages can quote field names and
          // XML context, so never log the unbounded raw array.
          issues: sanitize(
            workbookWarningIssues.slice(0, 5).map((issue) => ({
              ruleId: issue.ruleId,
              severity: issue.severity,
              message: issue.message.slice(0, 200),
            })),
          ),
        },
      });
    }

    const applyResult = await applyWorkbookText({ xml: workbookDoc, focus, executor, signal });
    if (applyResult.isErr()) {
      return Err({ type: 'execute-command-error', error: applyResult.error });
    }

    log({
      level: 'info',
      message: 'load-worksheet completed',
      logger: 'worksheetCommands',
      data: { worksheetName },
    });

    const verification = await verifyPostApplyWorksheetReadback(
      worksheetName,
      xml,
      executor,
      signal,
    );
    readbackVerificationOut?.push(publicReadbackVerificationResult(verification));
    const outcomeResult = readbackOutcome(verification);
    if (outcomeResult.isErr()) return outcomeResult;

    return outcomeResult;
  });
}

function sanitize(value: unknown): unknown {
  return sanitizeValue(value, {
    maxStringLength: 500,
    seen: new WeakSet<object>(),
    depth: 0,
  });
}
