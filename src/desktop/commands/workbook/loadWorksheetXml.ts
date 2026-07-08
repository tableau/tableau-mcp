import { Err, Ok, Result } from 'ts-results-es';

import { getDesktopConfig } from '../../../config.desktop.js';
import { log } from '../../../logging/logger.js';
import { sanitizeValue } from '../../../logging/sanitize.js';
import { buildMinimalSheetDoc } from '../../metadata/sheets.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { runValidation } from '../../validation/registry.js';
import { ValidationIssue } from '../../validation/types.js';
import { withApplyLock } from './applyMutex.js';
import { deleteLiveSheet } from './deleteLiveSheet.js';
import { getWorkbookXml } from './getWorkbookXml.js';
import { applyWorkbookText, interpretLoadOutcome } from './loadWorkbookXml.js';

export type LoadWorksheetXmlError =
  | { type: 'invalid-xml' }
  | { type: 'validation-failed'; issues: Array<ValidationIssue> }
  // The load-worksheet command reported command-level completion, but Tableau
  // rejected the actual document load (surfaced in the response payload, not in
  // `status`). `message` carries Desktop's own error text.
  | { type: 'load-rejected'; message: string };

type LoadWorksheetXmlResult = Result<
  void,
  | { type: 'execute-command-error'; error: ExecuteCommandError }
  | { type: 'load-worksheet-xml-error'; error: LoadWorksheetXmlError }
>;

export async function loadWorksheetXml({
  worksheetName,
  xml,
  executor,
  signal,
}: {
  worksheetName: string;
  xml: string;
} & WithExecutorAndAbortSignal): Promise<LoadWorksheetXmlResult> {
  xml = xml.trim();
  if (!xml || (!xml.startsWith('<?xml') && !xml.startsWith('<'))) {
    return Err({ type: 'load-worksheet-xml-error', error: { type: 'invalid-xml' } });
  }

  const validation = runValidation(xml, 'worksheet');
  if (!validation.valid) {
    log({
      level: 'error',
      message: 'Preflight validation failed — worksheet XML not sent to Tableau',
      logger: 'worksheetCommands',
      data: {
        worksheetName,
        issues: validation.issues,
        xmlPreview: sanitize(xml),
      },
    });

    return Err({
      type: 'load-worksheet-xml-error',
      error: { type: 'validation-failed', issues: validation.issues },
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

  // External Client API ("Athena V0") exposes no per-sheet route — tabui:load-worksheet is not
  // in its command registry, and the whole-workbook POST is additive-only, so applying a single
  // sheet has to delete the live copy first and re-post a minimal whole-workbook document.
  return getDesktopConfig().externalApiEnabled
    ? loadWorksheetXmlViaExternalApi({ worksheetName, xml, executor, signal })
    : loadWorksheetXmlViaAgentApi({ worksheetName, xml, executor, signal });
}

async function loadWorksheetXmlViaAgentApi({
  worksheetName,
  xml,
  executor,
  signal,
}: {
  worksheetName: string;
  xml: string;
} & WithExecutorAndAbortSignal): Promise<LoadWorksheetXmlResult> {
  const result = await executor.executeCommand({
    namespace: 'tabui',
    command: 'load-worksheet',
    signal,
    args: {
      worksheetName,
      worksheetXml: xml,
    },
  });

  if (result.isErr()) {
    return Err({ type: 'execute-command-error', error: result.error });
  }

  // Command completed — but "completed" means the command ran, not that Tableau
  // accepted the document load. A content rejection is surfaced in the payload,
  // so verify the actual load outcome before claiming success (mirrors the
  // workbook path). Otherwise a rejected load would be relayed as success.
  const outcome = interpretLoadOutcome(result.value);
  if (!outcome.ok) {
    log({
      level: 'error',
      message: 'load-worksheet completed but Tableau rejected the load',
      logger: 'worksheetCommands',
      data: { worksheetName, message: outcome.message },
    });

    return Err({
      type: 'load-worksheet-xml-error',
      error: { type: 'load-rejected', message: outcome.message },
    });
  }

  log({
    level: 'info',
    message: 'load-worksheet completed',
    logger: 'worksheetCommands',
    data: {
      worksheetName,
      commandId: result.value.command_id,
    },
  });

  return Ok.EMPTY;
}

async function loadWorksheetXmlViaExternalApi({
  worksheetName,
  xml,
  executor,
  signal,
}: {
  worksheetName: string;
  xml: string;
} & WithExecutorAndAbortSignal): Promise<LoadWorksheetXmlResult> {
  return withApplyLock(async () => {
    const workbookResult = await getWorkbookXml({ executor, signal });
    if (workbookResult.isErr()) {
      return Err({ type: 'execute-command-error', error: workbookResult.error });
    }

    let minimalDoc: string;
    try {
      minimalDoc = buildMinimalSheetDoc(workbookResult.value, worksheetName, xml);
    } catch (error) {
      return Err({ type: 'execute-command-error', error: { type: 'invalid-response', error } });
    }

    const deleteResult = await deleteLiveSheet({ sheetName: worksheetName, executor, signal });
    if (deleteResult.isErr()) {
      return Err({ type: 'execute-command-error', error: deleteResult.error });
    }

    const applyResult = await applyWorkbookText({ xml: minimalDoc, executor, signal });
    if (applyResult.isErr()) {
      return Err({ type: 'execute-command-error', error: applyResult.error });
    }

    log({
      level: 'info',
      message: 'load-worksheet completed',
      logger: 'worksheetCommands',
      data: { worksheetName },
    });

    return Ok.EMPTY;
  });
}

function sanitize(value: unknown): unknown {
  return sanitizeValue(value, {
    maxStringLength: 500,
    seen: new WeakSet<object>(),
    depth: 0,
  });
}
