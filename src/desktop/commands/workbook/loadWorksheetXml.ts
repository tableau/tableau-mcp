import { Err, Ok, Result } from 'ts-results-es';

import { log } from '../../../logging/logger.js';
import { sanitizeValue } from '../../../logging/sanitize.js';
import { normalizeArray, parseXML } from '../../metadata/parser.js';
import { upsertSheetIntoWorkbook } from '../../metadata/sheets.js';
import {
  deriveTargetWorksheetWindowState,
  deriveWorksheetApplyState,
  deriveWorksheetArtifactSha256,
  type WorksheetApplyState,
} from '../../metadata/targetWorksheetState.js';
import type { ParsedWorksheet } from '../../metadata/types.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import {
  formatReadbackVerificationError,
  type ReadbackFinding,
  type ReadbackVerificationResult,
  verifyWorksheetReadback,
} from '../../validation/readback-verify.js';
import { blockingValidationIssues, runValidation } from '../../validation/registry.js';
import { ValidationIssue } from '../../validation/types.js';
import { xmlNamesEqual } from '../../xmlElement.js';
import { withApplyLock } from './applyMutex.js';
import { getWorkbookXml } from './getWorkbookXml.js';
import { getWorksheetFragment } from './getWorksheetXml.js';
import { applyWorkbookText } from './loadWorkbookXml.js';

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
  | { type: 'preview-state-changed'; message: string }
  // Apply succeeded but the post-apply readback proved Tableau silently dropped or
  // changed an intent-bearing node (the silently-dropped-pill killer, W4). `message`
  // carries the agent-facing fix recipe; `findings` the structured evidence.
  | { type: 'readback-failed'; findings: ReadbackFinding[]; message: string };

/** Non-fatal readback warnings surfaced on a successful apply (sort drops/changes). */
export interface LoadWorksheetXmlOk {
  readbackWarnings: ReadbackFinding[];
  readbackVerification?: ReadbackVerificationResult;
  validationWarnings?: ValidationIssue[];
}

interface PostApplyWorksheetReadbackVerification extends ReadbackVerificationResult {
  findings: ReadbackFinding[];
}

type LoadWorksheetXmlResult = Result<
  LoadWorksheetXmlOk,
  | {
      type: 'execute-command-error';
      error: ExecuteCommandError;
      dispatchState?: 'not-dispatched' | 'possibly-dispatched';
    }
  | { type: 'load-worksheet-xml-error'; error: LoadWorksheetXmlError }
>;

const PRE_APPLY_STABILITY_ATTEMPTS = 3;
const POST_APPLY_WINDOW_SETTLE_MS = 500;

async function waitForDesktopSettle(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false;

  return await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => finish(true), ms);

    function finish(settled: boolean): void {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      resolve(settled);
    }

    function abort(): void {
      finish(false);
    }

    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

/**
 * Post-apply readback verification. Re-reads the just-applied worksheet and compares
 * intent-bearing structures against the authored XML. Never throws and never fails the
 * apply on a re-read miss: if the worksheet cannot be re-read, verification is skipped
 * (returns no findings) so telemetry can never mask a real apply.
 */
function publicReadbackVerificationResult(
  result: PostApplyWorksheetReadbackVerification,
): ReadbackVerificationResult {
  return result.message
    ? { ok: result.ok, status: result.status, message: result.message }
    : { ok: result.ok, status: result.status };
}

async function verifyPostApplyWorksheetReadback(
  worksheetName: string,
  intendedXml: string,
  executor: WithExecutorAndAbortSignal['executor'],
  signal: WithExecutorAndAbortSignal['signal'],
): Promise<PostApplyWorksheetReadbackVerification> {
  try {
    const reread = await getWorksheetFragment({ worksheetName, executor, signal });
    if (reread.isErr()) {
      const message =
        reread.error.type === 'get-worksheet-xml-error'
          ? reread.error.error.message
          : 'could not re-read worksheet after apply';
      log({
        level: 'warning',
        message: 'Post-apply worksheet readback verification skipped — could not re-read worksheet',
        logger: 'worksheetCommands',
        data: { worksheetName, status: 'skipped', error: reread.error },
      });
      return { ok: true, status: 'skipped', findings: [], message };
    }
    const findings = verifyWorksheetReadback(intendedXml, reread.value);
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
 * Canonical-name gate. The `<worksheet name>` in the authored XML is the identity Tableau
 * applies, so require the caller's `worksheetName` to agree with it before we touch Desktop.
 * Names are compared after trim and Unicode NFC normalization (case-sensitive) so visually
 * identical NFD/NFC spellings do not false-mismatch. Returns the validated canonical name — the
 * name exactly as authored in the XML (trimmed), which is what Tableau stores when it applies the
 * raw XML — for the load and readback, and so upsertSheetIntoWorkbook's own name check still matches.
 *
 * Only a single top-level `<worksheet>` fragment is a legal payload here (the same fragment
 * get-worksheet-xml returns and upsertSheetIntoWorkbook requires). A `<workbook>`-wrapped document has
 * no top-level identity to gate on, so it is rejected before apply with a recovery hint rather than
 * failing as a misleading mismatch against an empty XML name.
 */
function resolveCanonicalWorksheetName(
  worksheetName: string,
  xml: string,
): Result<string, Extract<LoadWorksheetXmlError, { type: 'name-mismatch' }>> {
  const callerName = worksheetName.trim();
  let xmlName = '';
  let isWorkbookDocument = false;
  try {
    const parsed = parseXML(xml);
    const worksheet = normalizeArray(parsed.worksheet as ParsedWorksheet | undefined)[0];
    xmlName = worksheet?.['@_name']?.trim() ?? '';
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
        ? 'apply-worksheet expects a single <worksheet name="..."> fragment, but the XML is a whole ' +
          `<workbook> document. FIX: Extract just the <worksheet name="${callerName}"> element and retry ` +
          'with that fragment as worksheetXml — or apply the whole document with apply-workbook.'
        : 'apply-worksheet could not find a top-level <worksheet name="..."> element in the XML. ' +
          `FIX: Provide a single <worksheet name="${callerName}"> fragment (as returned by get-worksheet-xml) ` +
          'as worksheetXml.',
    });
  }

  if (!xmlNamesEqual(xmlName, callerName)) {
    return Err({
      type: 'name-mismatch',
      message:
        `worksheet_name "${worksheetName}" does not match the <worksheet name> in the XML ("${xmlName}"). ` +
        `FIX: Retry with worksheet_name set to the XML's name "${xmlName}" — or update the <worksheet name> ` +
        `attribute in the XML to "${worksheetName}" if the caller name is intended.`,
    });
  }

  return Ok(xmlName);
}

export async function loadWorksheetXml({
  worksheetName,
  xml,
  executor,
  signal,
  readbackVerificationOut,
  expectedState,
  worksheetWindowXml,
}: {
  worksheetName: string;
  xml: string;
  readbackVerificationOut?: ReadbackVerificationResult[];
  expectedState?: WorksheetApplyState;
  worksheetWindowXml?: string;
} & WithExecutorAndAbortSignal): Promise<LoadWorksheetXmlResult> {
  xml = xml.trim();
  if (!xml || (!xml.startsWith('<?xml') && !xml.startsWith('<'))) {
    return Err({ type: 'load-worksheet-xml-error', error: { type: 'invalid-xml' } });
  }

  const validation = runValidation(xml, 'worksheet');
  const blockingIssues = blockingValidationIssues(validation.issues);
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

  // External Client API ("Athena V0") exposes no per-sheet apply route, so applying a single sheet
  // re-posts the whole live workbook with just this sheet swapped in (the POST replaces the open
  // workbook wholesale, so anything omitted would be pruned).
  const result = await loadWorksheetXmlViaExternalApi({
    worksheetName: canonicalName,
    xml,
    executor,
    signal,
    readbackVerificationOut,
    expectedState,
    worksheetWindowXml,
  });
  if (result.isErr()) {
    return result;
  }
  // Preflight warnings ride along so apply responses can compute the host
  // verification receipt (W-23447506) without re-running validation.
  return Ok({ ...result.value, validationWarnings: validation.issues });
}

async function loadWorksheetXmlViaExternalApi({
  worksheetName,
  xml,
  executor,
  signal,
  readbackVerificationOut,
  expectedState,
  worksheetWindowXml,
}: {
  worksheetName: string;
  xml: string;
  readbackVerificationOut?: ReadbackVerificationResult[];
  expectedState?: WorksheetApplyState;
  worksheetWindowXml?: string;
} & WithExecutorAndAbortSignal): Promise<LoadWorksheetXmlResult> {
  let didDispatch = false;
  const apply = async (): Promise<LoadWorksheetXmlResult> => {
    if (
      expectedState !== undefined &&
      deriveWorksheetArtifactSha256(xml, worksheetWindowXml) !== expectedState.artifactSha256
    ) {
      return Err({
        type: 'load-worksheet-xml-error',
        error: {
          type: 'preview-state-changed',
          message:
            `The artifact for worksheet "${worksheetName}" does not match the supplied worksheet or window. ` +
            'Build a new artifact from the intended worksheet and current workbook before applying.',
        },
      });
    }

    const workbookResult = await getWorkbookXml({ executor, signal });
    if (workbookResult.isErr()) {
      return Err({
        type: 'execute-command-error',
        error: workbookResult.error,
        dispatchState: 'not-dispatched',
      });
    }

    let sourceWorkbookXml = workbookResult.value;
    let workbookDoc: string | null = null;
    // ECA exposes no revision/If-Match primitive; this bounded stable-read loop narrows but cannot eliminate the final read-to-POST race.
    for (let attempt = 1; attempt <= PRE_APPLY_STABILITY_ATTEMPTS; attempt++) {
      if (expectedState !== undefined) {
        let currentState: WorksheetApplyState;
        try {
          currentState = deriveWorksheetApplyState(
            sourceWorkbookXml,
            worksheetName,
            xml,
            worksheetWindowXml,
          );
        } catch (error) {
          return Err({
            type: 'execute-command-error',
            error: { type: 'invalid-response', error },
            dispatchState: 'not-dispatched',
          });
        }

        if (!worksheetApplyStatesEqual(currentState, expectedState)) {
          return previewStateChanged(worksheetName);
        }
      }

      let candidateWorkbookDoc: string;
      try {
        candidateWorkbookDoc = upsertSheetIntoWorkbook(
          sourceWorkbookXml,
          worksheetName,
          xml,
          worksheetWindowXml,
        );
      } catch (error) {
        return Err({
          type: 'execute-command-error',
          error: { type: 'invalid-response', error },
          dispatchState: 'not-dispatched',
        });
      }

      const workbookDocValidation = runValidation(candidateWorkbookDoc, 'workbook');
      const workbookValidationIssues = workbookDocValidation.issues;
      const workbookBlockingIssues = blockingValidationIssues(workbookValidationIssues);
      if (workbookBlockingIssues.length > 0) {
        log({
          level: 'error',
          message:
            'Constructed worksheet apply document failed workbook validation — XML not sent to Tableau',
          logger: 'worksheetCommands',
          data: {
            worksheetName,
            issues: workbookBlockingIssues,
            xmlPreview: sanitize(candidateWorkbookDoc),
          },
        });

        return Err({
          type: 'load-worksheet-xml-error',
          error: { type: 'validation-failed', issues: workbookBlockingIssues },
        });
      }

      const workbookWarningIssues = workbookValidationIssues.filter(
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

      // Generic apply has no build-time snapshot to protect; retain its existing one-read path.
      if (expectedState === undefined) {
        workbookDoc = candidateWorkbookDoc;
        break;
      }

      const stabilityRead = await getWorkbookXml({ executor, signal });
      if (stabilityRead.isErr()) {
        return Err({
          type: 'execute-command-error',
          error: stabilityRead.error,
          dispatchState: 'not-dispatched',
        });
      }
      if (stabilityRead.value === sourceWorkbookXml) {
        workbookDoc = candidateWorkbookDoc;
        break;
      }

      if (expectedState !== undefined) {
        let latestState: WorksheetApplyState;
        try {
          latestState = deriveWorksheetApplyState(
            stabilityRead.value,
            worksheetName,
            xml,
            worksheetWindowXml,
          );
        } catch (error) {
          return Err({
            type: 'execute-command-error',
            error: { type: 'invalid-response', error },
            dispatchState: 'not-dispatched',
          });
        }
        if (!worksheetApplyStatesEqual(latestState, expectedState)) {
          return previewStateChanged(worksheetName);
        }
      }

      if (attempt === PRE_APPLY_STABILITY_ATTEMPTS) {
        return Err({
          type: 'load-worksheet-xml-error',
          error: {
            type: 'preview-state-changed',
            message:
              `The live workbook kept changing while preparing worksheet "${worksheetName}". ` +
              'Nothing was applied. Retry after the workbook is stable.',
          },
        });
      }
      sourceWorkbookXml = stabilityRead.value;
    }

    if (workbookDoc === null) {
      return Err({
        type: 'load-worksheet-xml-error',
        error: {
          type: 'preview-state-changed',
          message: `Could not establish a stable workbook state for worksheet "${worksheetName}". Retry the apply.`,
        },
      });
    }

    didDispatch = true;
    const applyResult = await applyWorkbookText({ xml: workbookDoc, executor, signal });
    if (applyResult.isErr()) {
      return Err({
        type: 'execute-command-error',
        error: applyResult.error,
        dispatchState: 'possibly-dispatched',
      });
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
    if (verification.ok && expectedState !== undefined && worksheetWindowXml !== undefined) {
      try {
        const intendedWindow = deriveTargetWorksheetWindowState(workbookDoc, worksheetName);
        const settled = await waitForDesktopSettle(POST_APPLY_WINDOW_SETTLE_MS, signal);
        if (!settled) {
          return Err({
            type: 'execute-command-error',
            error: {
              type: 'unknown',
              error:
                signal.reason ?? new Error('Post-apply worksheet window verification was aborted'),
            },
            dispatchState: 'possibly-dispatched',
          });
        }

        const workbookReadback = await getWorkbookXml({ executor, signal });
        if (workbookReadback.isErr()) {
          return Err({
            type: 'execute-command-error',
            error: workbookReadback.error,
            dispatchState: 'possibly-dispatched',
          });
        }
        const liveWindow = deriveTargetWorksheetWindowState(workbookReadback.value, worksheetName);
        const windowsMatch =
          intendedWindow.state === liveWindow.state &&
          (intendedWindow.state === 'absent' ||
            (liveWindow.state === 'present' && intendedWindow.sha256 === liveWindow.sha256));

        if (!windowsMatch) {
          log({
            level: 'warning',
            message: 'Post-apply worksheet window verification failed after Desktop settle',
            logger: 'worksheetCommands',
            data: sanitize({
              worksheetName,
              attemptCount: 1,
              intendedWindow,
              liveWindow,
            }),
          });
          verification.ok = false;
          verification.status = 'failed';
          verification.findings.push({
            kind: 'window',
            node: 'window/cards',
            intended: `<window class="worksheet" name="${worksheetName}">`,
            readback: liveWindow.state === 'absent' ? 'missing' : 'changed',
            severity: 'error',
          });
        }
      } catch (error) {
        return Err({
          type: 'execute-command-error',
          error: { type: 'invalid-response', error },
          dispatchState: 'possibly-dispatched',
        });
      }
    }
    readbackVerificationOut?.push(publicReadbackVerificationResult(verification));
    const outcomeResult = readbackOutcome(verification);
    if (outcomeResult.isErr()) return outcomeResult;

    return outcomeResult;
  };

  const lockKey =
    expectedState === undefined
      ? undefined
      : executor.desktopInstanceId
        ? `instance:${executor.desktopInstanceId}`
        : executor.desktopProcessId !== undefined
          ? `pid:${executor.desktopProcessId}`
          : undefined;
  try {
    return await withApplyLock(apply, lockKey === undefined ? undefined : { key: lockKey, signal });
  } catch (error) {
    return Err({
      type: 'execute-command-error',
      error: { type: 'unknown', error },
      dispatchState: didDispatch ? 'possibly-dispatched' : 'not-dispatched',
    });
  }
}

function previewStateChanged(worksheetName: string): LoadWorksheetXmlResult {
  return Err({
    type: 'load-worksheet-xml-error',
    error: {
      type: 'preview-state-changed',
      message:
        `The workbook changed after the artifact for worksheet "${worksheetName}" was built. ` +
        'Nothing was applied. Build a new artifact from the current workbook state if the worksheet is still wanted.',
    },
  });
}

function worksheetApplyStatesEqual(
  current: WorksheetApplyState,
  expected: WorksheetApplyState,
): boolean {
  const targetsMatch =
    current.target.state === expected.target.state &&
    (current.target.state === 'absent' ||
      (expected.target.state === 'present' && current.target.sha256 === expected.target.sha256));
  const targetWindowsMatch =
    current.targetWindow.state === expected.targetWindow.state &&
    (current.targetWindow.state === 'absent' ||
      (expected.targetWindow.state === 'present' &&
        current.targetWindow.sha256 === expected.targetWindow.sha256));
  return (
    current.workbookSha256 === expected.workbookSha256 &&
    targetsMatch &&
    targetWindowsMatch &&
    current.dependenciesSha256 === expected.dependenciesSha256
  );
}

function sanitize(value: unknown): unknown {
  return sanitizeValue(value, {
    maxStringLength: 500,
    seen: new WeakSet<object>(),
    depth: 0,
  });
}
