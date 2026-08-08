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

export type LoadWorkbookXmlError =
  | { type: 'invalid-xml' }
  | { type: 'validation-failed'; issues: Array<ValidationIssue> }
  | { type: 'workbook-drift' }
  // The workbook document POST reported transport-level completion, but Tableau
  // rejected the actual document load (e.g. "Qualified Name Parse Error").
  // `message` carries Desktop's own error text.
  | { type: 'load-rejected'; message: string };

export interface LoadWorkbookXmlOk {
  validationWarnings: ValidationIssue[];
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
  focus,
  applyOptions,
  executor,
  signal,
}: {
  xml: string;
  baselineXml?: string;
  expectedWorkbookXml?: string;
  focus: ApplyFocus;
  applyOptions?: ApplyWorkbookDocumentOptions;
  filePath?: string;
} & WithExecutorAndAbortSignal): Promise<LoadWorkbookXmlResult> {
  xml = xml.trim();
  if (!xml || (!xml.startsWith('<?xml') && !xml.startsWith('<'))) {
    return Err({ type: 'load-workbook-xml-error', error: { type: 'invalid-xml' } });
  }

  // Preflight semantic validation — catches known failure patterns before
  // sending XML to Tableau. Rules are extensible via src/validation/rules/.
  const validation = runValidation(xml, 'workbook');
  const blockingIssues =
    baselineXml === undefined
      ? blockingValidationIssues(validation.issues)
      : introducedBlockingValidationIssues(
          runValidation(baselineXml, 'workbook').issues,
          validation.issues,
        );
  if (blockingIssues.length > 0) {
    log({
      level: 'error',
      message: 'Preflight validation failed — XML not sent to Tableau',
      logger: 'workbookCommands',
      data: blockingIssues,
    });

    return Err({
      type: 'load-workbook-xml-error',
      error: { type: 'validation-failed', issues: blockingIssues },
    });
  }

  if (validation.issues.length > 0) {
    log({
      level: 'warning',
      message: 'Preflight validation warnings (continuing)',
      logger: 'workbookCommands',
      data: validation.issues,
    });
  }

  // The External Client API whole-workbook POST is authoritative: Desktop replaces
  // the open workbook from the posted document. The apply lock serializes it against
  // the per-sheet paths' fetch-modify-apply.
  return await withApplyLock(async (): Promise<LoadWorkbookXmlResult> => {
    if (expectedWorkbookXml !== undefined) {
      const currentWorkbook = await executor.getWorkbookDocument(signal);
      if (currentWorkbook.isErr()) {
        return Err({ type: 'execute-command-error', error: currentWorkbook.error });
      }
      if (currentWorkbook.value.xml !== expectedWorkbookXml) {
        return Err({
          type: 'load-workbook-xml-error',
          error: { type: 'workbook-drift' },
        });
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
