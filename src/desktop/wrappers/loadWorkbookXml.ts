import { Err, Ok, Result } from 'ts-results-es';

import { log } from '../../logging/logger.js';
import {
  ApplyWorkbookDocumentOptions,
  ExecuteCommandError,
  ExecuteCommandWarning,
  WithExecutorAndAbortSignal,
} from '../externalApi/executorTypes.js';
import type { WorkbookDiagnostics } from '../externalApi/types.js';
import { readWorkbookActions } from '../metadata/workbookActions.js';
import {
  blockingValidationIssues,
  introducedBlockingValidationIssues,
  runAlwaysBlockingValidation,
  runValidation,
} from '../validation/registry.js';
import { ValidationIssue } from '../validation/types.js';
import { type ApplyFocus, dispatchApplyFocus } from './applyFocus.js';
import { withApplyLock } from './applyMutex.js';
import { sourceSha256 } from './cacheFingerprint.js';
import { stripCarriedActions } from './carriedActions.js';
import { pollReadback, READBACK_POLL_INTERVAL_MS, sleep } from './pollReadback.js';

export type LoadWorkbookXmlError =
  | { type: 'invalid-xml' }
  | { type: 'validation-failed'; issues: Array<ValidationIssue> }
  | { type: 'workbook-drift'; message?: string }
  // The workbook document POST reported transport-level completion, but Tableau
  // rejected the actual document load (e.g. "Qualified Name Parse Error").
  // `message` carries Desktop's own error text.
  | { type: 'load-rejected'; message: string };

export interface LoadWorkbookXmlOk {
  validationWarnings: ValidationIssue[];
  documentWarnings: ExecuteCommandWarning[];
  diagnostics?: WorkbookDiagnostics;
  diagnosticsInvalid?: boolean;
}

export function describeLoadWorkbookXmlError(error: LoadWorkbookXmlError): string {
  if (error.type === 'workbook-drift') return 'The workbook changed before the authoring write.';
  if (error.type === 'load-rejected') return error.message;
  if (error.type === 'validation-failed') {
    return error.issues.map((issue) => issue.message).join('; ');
  }
  return 'The workbook XML was invalid.';
}

type LoadWorkbookXmlResult = Result<
  LoadWorkbookXmlOk,
  | { type: 'execute-command-error'; error: ExecuteCommandError }
  | { type: 'load-workbook-xml-error'; error: LoadWorkbookXmlError }
>;

export async function loadWorkbookXml({
  xml,
  baselineXml,
  expectedWorkbookXml,
  expectedSourceHash,
  cachedLiveRelative,
  focus,
  applyOptions,
  executor,
  signal,
  skipValidation,
}: {
  xml: string;
  baselineXml?: string;
  expectedWorkbookXml?: string;
  expectedSourceHash?: string;
  cachedLiveRelative?: boolean;
  focus: ApplyFocus;
  applyOptions?: ApplyWorkbookDocumentOptions;
  filePath?: string;
  skipValidation?: boolean;
} & WithExecutorAndAbortSignal): Promise<LoadWorkbookXmlResult> {
  xml = xml.trim();
  if (!xml || (!xml.startsWith('<?xml') && !xml.startsWith('<'))) {
    return Err({ type: 'load-workbook-xml-error', error: { type: 'invalid-xml' } });
  }

  // Preflight semantic validation — catches known failure patterns before
  // sending XML to Tableau. Rules are extensible via src/validation/rules/.
  // Trusted deterministic paths skip ordinary checks, but never known crash hazards.
  // Other baseline defects may be preserved while repairing the submitted document.
  let validation = { valid: true, issues: [] as ValidationIssue[] };
  if (!cachedLiveRelative || skipValidation) {
    validation = skipValidation
      ? runAlwaysBlockingValidation(xml, 'workbook')
      : runValidation(xml, 'workbook');
    const blockingIssues = skipValidation
      ? blockingValidationIssues(validation.issues)
      : baselineXml === undefined
        ? blockingValidationIssues(validation.issues)
        : introducedBlockingValidationIssues(
            runValidation(baselineXml, 'workbook').issues,
            validation.issues,
          );
    const validationError = rejectBlockingValidationIssues(blockingIssues);
    if (validationError !== undefined) return validationError;
    logValidationWarnings(validation.issues);
  }

  // The apply lock serializes this whole-workbook POST against the per-sheet fetch-modify-apply paths.
  return await withApplyLock(async (): Promise<LoadWorkbookXmlResult> => {
    const currentWorkbook = await executor.getWorkbookDocument(signal);
    if (currentWorkbook.isErr()) {
      return Err({ type: 'execute-command-error', error: currentWorkbook.error });
    }
    if (expectedWorkbookXml !== undefined && currentWorkbook.value.xml !== expectedWorkbookXml) {
      return Err({
        type: 'load-workbook-xml-error',
        error: { type: 'workbook-drift' },
      });
    }
    if (
      expectedSourceHash !== undefined &&
      sourceSha256(currentWorkbook.value.xml) !== expectedSourceHash
    ) {
      return Err({
        type: 'load-workbook-xml-error',
        error: {
          type: 'workbook-drift',
          message:
            'The workbook changed since this cache was read. Re-read it with get-workbook-xml, ' +
            'reapply your edit to the new cache file, then retry apply-workbook. No changes were sent to Tableau.',
        },
      });
    }

    if (cachedLiveRelative && !skipValidation) {
      validation = runValidation(xml, 'workbook');
      const blockingIssues = introducedBlockingValidationIssues(
        runValidation(currentWorkbook.value.xml, 'workbook').issues,
        validation.issues,
      );
      const validationError = rejectBlockingValidationIssues(blockingIssues);
      if (validationError !== undefined) return validationError;
      validation = {
        valid: true,
        issues: validation.issues.filter((issue) => issue.severity !== 'error'),
      };
      logValidationWarnings(validation.issues);
    }

    const result = await applyWorkbookText({
      xml,
      focus,
      executor,
      signal,
      applyOptions,
      liveXml: currentWorkbook.value.xml,
    });
    if (result.isErr()) {
      return Err({ type: 'execute-command-error', error: result.error });
    }
    // Preflight warnings ride along so apply responses can compute the host
    // verification receipt (W-23447506) without re-running validation.
    return Ok({ validationWarnings: validation.issues, ...result.value });
  });
}

function rejectBlockingValidationIssues(
  issues: ValidationIssue[],
): LoadWorkbookXmlResult | undefined {
  if (issues.length === 0) return undefined;

  log({
    level: 'error',
    message: 'Preflight validation failed — XML not sent to Tableau',
    logger: 'workbookCommands',
    data: issues,
  });

  return Err({
    type: 'load-workbook-xml-error',
    error: { type: 'validation-failed', issues },
  });
}

function logValidationWarnings(issues: ValidationIssue[]): void {
  if (issues.length === 0) return;
  log({
    level: 'warning',
    message: 'Preflight validation warnings (continuing)',
    logger: 'workbookCommands',
    data: issues,
  });
}

// Only 'replace' is remembered: a stale 'append' would hide a Desktop upgrade that starts replacing.
const actionHandlingByInstance = new Map<string, 'replace'>();

export function resetActionHandlingMemo(): void {
  actionHandlingByInstance.clear();
}

type ApplyTextOk = {
  documentWarnings: ExecuteCommandWarning[];
  diagnostics?: WorkbookDiagnostics;
  diagnosticsInvalid?: boolean;
};

async function postWorkbookText({
  xml,
  executor,
  signal,
  applyOptions,
}: {
  xml: string;
  applyOptions?: ApplyWorkbookDocumentOptions;
} & WithExecutorAndAbortSignal): Promise<Result<ApplyTextOk, ExecuteCommandError>> {
  const result = await executor.applyWorkbookDocument(xml, signal, applyOptions);

  if (result.isErr()) {
    log({
      level: 'error',
      message: 'Workbook document apply failed',
      logger: 'workbookCommands',
      data: { error: result.error },
    });
    return result;
  }

  log({
    level: 'info',
    message: 'Workbook document apply completed',
    logger: 'workbookCommands',
    data: {
      commandId: result.value.command_id,
      hasResult: !!result.value.result,
    },
  });

  return Ok({
    documentWarnings: result.value.warnings ?? [],
    ...(result.value.diagnostics ? { diagnostics: result.value.diagnostics } : {}),
    ...(result.value.diagnosticsInvalid ? { diagnosticsInvalid: true } : {}),
  });
}

// Appending Desktop builds copy every live action on each POST, so carried actions are left out.
async function applyWithoutCarriedActions({
  xml,
  liveXml,
  executor,
  signal,
  applyOptions,
}: {
  xml: string;
  liveXml: string | undefined;
  applyOptions?: ApplyWorkbookDocumentOptions;
} & WithExecutorAndAbortSignal): Promise<
  Result<{ posted: ApplyTextOk; postedXml: string }, ExecuteCommandError>
> {
  const instanceId = executor.desktopInstanceId;
  const stripped =
    liveXml !== undefined && actionHandlingByInstance.get(instanceId ?? '') !== 'replace'
      ? stripCarriedActions(xml, liveXml)
      : undefined;
  if (liveXml === undefined || stripped === undefined) {
    const posted = await postWorkbookText({ xml, executor, signal, applyOptions });
    return posted.map((value) => ({ posted: value, postedXml: xml }));
  }

  const first = await postWorkbookText({ xml: stripped.xml, executor, signal, applyOptions });
  if (first.isErr()) return first;

  const undecided = (): Result<{ posted: ApplyTextOk; postedXml: string }, ExecuteCommandError> =>
    Ok({ posted: first.value, postedXml: stripped.xml });
  const missingCarried = (readbackXml: string): string[] | undefined => {
    const present = readWorkbookActions(readbackXml);
    if (present.isErr()) return undefined;
    const names = new Set(present.value.map((action) => action.name));
    return stripped.carriedNames.filter((name) => !names.has(name));
  };

  // The POST already landed, so an abort or read failure here must not fail the apply.
  try {
    // Unchanged GET bytes mean the POST has not settled yet.
    const readback = await pollReadback({
      read: () => executor.getWorkbookDocument(signal),
      settled: (doc) => doc.xml !== liveXml,
      signal,
    });
    const missing =
      readback.ok && readback.settled ? missingCarried(readback.value.xml) : undefined;
    if (missing === undefined) {
      log({
        level: 'info',
        message: 'Could not tell whether this Desktop build keeps workbook actions on load',
        logger: 'workbookCommands',
      });
      return undecided();
    }
    if (missing.length === 0) return undecided();
    if (missing.length < stripped.carriedNames.length) {
      log({
        level: 'info',
        message: 'Some carried workbook actions are missing after load; not re-sending',
        logger: 'workbookCommands',
        data: { missing: missing.length, carried: stripped.carriedNames.length },
      });
      return undecided();
    }

    // Re-read once so a slow settle is not mistaken for a build that replaces actions.
    await sleep(READBACK_POLL_INTERVAL_MS, signal);
    const again = await executor.getWorkbookDocument(signal);
    const stillMissing = again.isOk() ? missingCarried(again.value.xml) : undefined;
    if (stillMissing === undefined || stillMissing.length !== stripped.carriedNames.length) {
      return undecided();
    }
  } catch (error) {
    log({
      level: 'info',
      message: 'Skipped the workbook action check after the apply landed',
      logger: 'workbookCommands',
      data: { error: error instanceof Error ? error.message : String(error) },
    });
    return undecided();
  }

  if (instanceId !== undefined) actionHandlingByInstance.set(instanceId, 'replace');
  log({
    level: 'info',
    message: 'Desktop replaced the workbook actions; re-sending the full document',
    logger: 'workbookCommands',
    data: { carried: stripped.carriedNames.length },
  });
  const second = await postWorkbookText({ xml, executor, signal, applyOptions });
  if (second.isErr()) {
    return Err({
      type: 'command-failed',
      error: {
        code: 'workbook-actions-removed',
        message:
          "This Desktop build removed the workbook's actions on load, and restoring them failed. " +
          'Use undo-workbook to step back to the workbook from before this call, then check Dashboard > Actions.',
        recoverable: false,
      },
    });
  }
  return Ok({ posted: second.value, postedXml: xml });
}

// Low-level "POST the whole document as text" call shared by the External Client API's
// whole-workbook apply (loadWorkbookXml) and the per-sheet write commands' minimal-doc apply
// (loadWorksheetXml / loadDashboardXml). Pass `liveXml` for a whole-workbook payload built from a
// live read; per-sheet payloads carry no actions and omit it.
export async function applyWorkbookText({
  xml,
  liveXml,
  focus,
  executor,
  signal,
  applyOptions,
}: {
  xml: string;
  liveXml?: string;
  focus: ApplyFocus;
  applyOptions?: ApplyWorkbookDocumentOptions;
} & WithExecutorAndAbortSignal): Promise<Result<ApplyTextOk, ExecuteCommandError>> {
  const result = await applyWithoutCarriedActions({ xml, liveXml, executor, signal, applyOptions });
  if (result.isErr()) return result;

  // The POST moved the view whether we asked or not, so say where it belongs. Never
  // fails the apply that already landed.
  await dispatchApplyFocus({ focus, postedXml: result.value.postedXml, executor, signal });

  return Ok(result.value.posted);
}
