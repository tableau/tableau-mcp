import { Err, Ok, Result } from 'ts-results-es';

import { log } from '../../logging/logger.js';
import {
  ApplyWorkbookDocumentOptions,
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../externalApi/executorTypes.js';
import {
  blockingValidationIssues,
  introducedBlockingValidationIssues,
  runValidation,
} from '../validation/registry.js';
import { ValidationIssue } from '../validation/types.js';
import { type ApplyFocus, dispatchApplyFocus } from './applyFocus.js';
import { withApplyLock } from './applyMutex.js';
import { sourceSha256 } from './cacheFingerprint.js';

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
  // Skipped entirely on the trusted deterministic path (skipValidation); otherwise
  // fail only on blocking issues, or on baseline-introduced ones when a baseline is given.
  let validation = { valid: true, issues: [] as ValidationIssue[] };
  if (!cachedLiveRelative) {
    validation = skipValidation
      ? { valid: true, issues: [] as ValidationIssue[] }
      : runValidation(xml, 'workbook');
    const blockingIssues = skipValidation
      ? []
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

  // The External Client API whole-workbook POST is authoritative: Desktop replaces
  // the open workbook from the posted document. The apply lock serializes it against
  // the per-sheet paths' fetch-modify-apply.
  return await withApplyLock(async (): Promise<LoadWorkbookXmlResult> => {
    if (
      cachedLiveRelative ||
      expectedWorkbookXml !== undefined ||
      expectedSourceHash !== undefined
    ) {
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
    }

    const result = await applyWorkbookText({ xml, focus, executor, signal, applyOptions });
    if (result.isErr()) {
      return Err({ type: 'execute-command-error', error: result.error });
    }
    // Preflight warnings ride along so apply responses can compute the host
    // verification receipt (W-23447506) without re-running validation.
    return Ok({ validationWarnings: validation.issues });
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

// Low-level "POST the whole document as text" call shared by the External Client API's
// whole-workbook apply (loadWorkbookXml) and the per-sheet write commands' minimal-doc apply
// (loadWorksheetXml / loadDashboardXml).
export async function applyWorkbookText({
  xml,
  focus,
  executor,
  signal,
  applyOptions,
}: {
  xml: string;
  focus: ApplyFocus;
  applyOptions?: ApplyWorkbookDocumentOptions;
} & WithExecutorAndAbortSignal): Promise<Result<void, ExecuteCommandError>> {
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

  // The POST moved the view whether we asked or not, so say where it belongs. Never
  // fails the apply that already landed.
  await dispatchApplyFocus({ focus, postedXml: xml, executor, signal });

  return Ok.EMPTY;
}
