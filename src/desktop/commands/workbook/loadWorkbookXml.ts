import { Err, Ok, Result } from 'ts-results-es';

import { log } from '../../../logging/logger.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { runValidation } from '../../validation/registry.js';
import { ValidationIssue } from '../../validation/types.js';
import { withApplyLock } from './applyMutex.js';

export type LoadWorkbookXmlError =
  | { type: 'invalid-xml' }
  | { type: 'validation-failed'; issues: Array<ValidationIssue> }
  // Bug 1 (P0): the load-underlying-metadata command reported command-level
  // completion, but Tableau rejected the actual document load (e.g. "Qualified
  // Name Parse Error"). `message` carries Desktop's own error text.
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
  executor,
  signal,
}: {
  xml: string;
  filePath?: string;
} & WithExecutorAndAbortSignal): Promise<LoadWorkbookXmlResult> {
  xml = xml.trim();
  if (!xml || (!xml.startsWith('<?xml') && !xml.startsWith('<'))) {
    return Err({ type: 'load-workbook-xml-error', error: { type: 'invalid-xml' } });
  }

  // Preflight semantic validation — catches known failure patterns before
  // sending XML to Tableau. Rules are extensible via src/validation/rules/.
  const validation = runValidation(xml, 'workbook');
  if (!validation.valid) {
    log({
      level: 'error',
      message: 'Preflight validation failed — XML not sent to Tableau',
      logger: 'workbookCommands',
      data: validation.issues,
    });

    return Err({
      type: 'load-workbook-xml-error',
      error: { type: 'validation-failed', issues: validation.issues },
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
  const result = await withApplyLock(() => applyWorkbookText({ xml, executor, signal }));
  if (result.isErr()) {
    return Err({ type: 'execute-command-error', error: result.error });
  }
  // Preflight warnings ride along so apply responses can compute the host
  // verification receipt (W-23447506) without re-running validation.
  return Ok({ validationWarnings: validation.issues });
}

// Low-level "POST the whole document as text" call shared by the External Client API's
// whole-workbook apply (loadWorkbookXml) and the per-sheet write commands' minimal-doc apply
// (loadWorksheetXml / loadDashboardXml).
export async function applyWorkbookText({
  xml,
  executor,
  signal,
}: { xml: string } & WithExecutorAndAbortSignal): Promise<Result<void, ExecuteCommandError>> {
  const result = await executor.executeCommand({
    namespace: 'tabui',
    command: 'load-underlying-metadata',
    signal,
    args: {
      text: xml,
    },
  });

  if (result.isErr()) {
    log({
      level: 'error',
      message: 'load-underlying-metadata (text) failed',
      logger: 'workbookCommands',
      data: { error: result.error },
    });
    return result;
  }

  log({
    level: 'info',
    message: 'load-underlying-metadata (text) completed',
    logger: 'workbookCommands',
    data: {
      commandId: result.value.command_id,
      hasResult: !!result.value.result,
    },
  });

  return Ok.EMPTY;
}
