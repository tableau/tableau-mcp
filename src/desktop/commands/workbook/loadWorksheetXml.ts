import { Err, Ok, Result } from 'ts-results-es';

import { getDesktopConfig } from '../../../config.desktop.js';
import { log } from '../../../logging/logger.js';
import { sanitizeValue } from '../../../logging/sanitize.js';
import { buildMinimalSheetDoc } from '../../metadata/sheets.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import {
  formatReadbackVerificationError,
  type ReadbackFinding,
  verifyWorksheetReadback,
} from '../../validation/readback-verify.js';
import { runValidation } from '../../validation/registry.js';
import { ValidationIssue } from '../../validation/types.js';
import { withApplyLock } from './applyMutex.js';
import { focusAppliedSheetBestEffort } from './focusAppliedSheet.js';
import { getWorkbookXml } from './getWorkbookXml.js';
import { getWorksheetXml } from './getWorksheetXml.js';
import { applyWorkbookText, interpretLoadOutcome } from './loadWorkbookXml.js';

export type LoadWorksheetXmlError =
  | { type: 'invalid-xml' }
  | { type: 'validation-failed'; issues: Array<ValidationIssue> }
  // The load-worksheet command reported command-level completion, but Tableau
  // rejected the actual document load (surfaced in the response payload, not in
  // `status`). `message` carries Desktop's own error text.
  | { type: 'load-rejected'; message: string }
  // Apply succeeded but the post-apply readback proved Tableau silently dropped or
  // changed an intent-bearing node (the silently-dropped-pill killer, W4). `message`
  // carries the agent-facing fix recipe; `findings` the structured evidence.
  | { type: 'readback-failed'; findings: ReadbackFinding[]; message: string };

/** Non-fatal readback warnings surfaced on a successful apply (sort drops/changes). */
export interface LoadWorksheetXmlOk {
  readbackWarnings: ReadbackFinding[];
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
async function verifyReadbackAfterApply(
  worksheetName: string,
  intendedXml: string,
  executor: WithExecutorAndAbortSignal['executor'],
  signal: WithExecutorAndAbortSignal['signal'],
): Promise<ReadbackFinding[]> {
  try {
    const reread = await getWorksheetXml({ worksheetName, executor, signal });
    if (reread.isErr()) {
      log({
        level: 'warning',
        message: 'Post-apply worksheet readback verification skipped — could not re-read worksheet',
        logger: 'worksheetCommands',
        data: { worksheetName, error: reread.error },
      });
      return [];
    }
    return verifyWorksheetReadback(intendedXml, reread.value);
  } catch (error) {
    log({
      level: 'warning',
      message: 'Post-apply worksheet readback verification skipped — re-read threw',
      logger: 'worksheetCommands',
      data: { worksheetName, error: error instanceof Error ? error.message : String(error) },
    });
    return [];
  }
}

/**
 * Turn readback findings into a load outcome: ERROR-severity findings fail the apply
 * (the rendered chart does not match intent), WARNING-severity findings ride along on a
 * successful Ok so the tool can surface them without blocking.
 */
function readbackOutcome(findings: ReadbackFinding[]): LoadWorksheetXmlResult {
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
  return Ok({ readbackWarnings: findings });
}

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

  // External Client API ("Athena V0") exposes no per-sheet route — tabui:load-worksheet is not in
  // its command registry, so applying a single sheet re-posts a minimal whole-workbook document.
  // The POST upserts by name: it overwrites the colliding sheet in place and leaves the rest live.
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

  // Verify the apply landed durably BEFORE focusing — an ERROR-severity readback means
  // Tableau silently dropped intent-bearing nodes, so we reject and never navigate to the
  // broken sheet (W4). WARNING-severity findings ride along on the successful Ok.
  const findings = await verifyReadbackAfterApply(worksheetName, xml, executor, signal);
  const outcomeResult = readbackOutcome(findings);
  if (outcomeResult.isErr()) return outcomeResult;

  await focusAppliedSheetBestEffort({
    sheetName: worksheetName,
    appliedVia: 'load-worksheet',
    executor,
    signal,
  });

  return outcomeResult;
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

    const findings = await verifyReadbackAfterApply(worksheetName, xml, executor, signal);
    const outcomeResult = readbackOutcome(findings);
    if (outcomeResult.isErr()) return outcomeResult;

    await focusAppliedSheetBestEffort({
      sheetName: worksheetName,
      appliedVia: 'load-worksheet',
      executor,
      signal,
    });

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
