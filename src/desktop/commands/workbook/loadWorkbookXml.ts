import { writeFileSync } from 'fs';
import { Err, Ok, Result } from 'ts-results-es';

import { getDesktopConfig } from '../../../config.desktop.js';
import { log } from '../../../logging/logger.js';
import { GetCommandStatusResponse } from '../../../sdks/desktop/agentApi/types.js';
import { DesktopCache } from '../../cache.js';
import { xmlToJson } from '../../libraries/workbook-serialization-converter';
import { listWorkbookDashboards } from '../../metadata/dashboards.js';
import { listSheets } from '../../metadata/sheets.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { runValidation } from '../../validation/registry.js';
import { ValidationIssue } from '../../validation/types.js';
import { withApplyLock } from './applyMutex.js';
import { getWorkbookXml } from './getWorkbookXml.js';

export type LoadWorkbookXmlError =
  | { type: 'invalid-xml' }
  | { type: 'validation-failed'; issues: Array<ValidationIssue> }
  // Bug 1 (P0): the load-underlying-metadata command reported command-level
  // completion, but Tableau rejected the actual document load (e.g. "Qualified
  // Name Parse Error"). `message` carries Desktop's own error text.
  | { type: 'load-rejected'; message: string };

/**
 * Load-outcome type shared by both apply helpers below.
 */
type LoadHelperResult = Result<
  void,
  | { type: 'execute-command-error'; error: ExecuteCommandError }
  | { type: 'load-workbook-xml-error'; error: LoadWorkbookXmlError }
>;

/**
 * Inspect a COMPLETED `load-underlying-metadata` command status for a document
 * load failure. Tableau's Agent API reports the COMMAND as `status: 'completed'`
 * once it has accepted the payload, but a rejected document load (mismatched
 * brackets, a dropped worksheet, etc.) is surfaced in the response payload — a
 * top-level `error`, or a failure signal inside `result` — not in `status`. The
 * executor only maps `status: 'failed'` to an error, so without this check a
 * rejected load is relayed as success (the P0 "apply must not lie" bug).
 *
 * Conservative by design: it only reports failure on an EXPLICIT failure signal,
 * so a normal success (empty `result`, no `error`) is never turned into a false
 * negative.
 */
export function interpretLoadOutcome(
  status: GetCommandStatusResponse,
): { ok: true } | { ok: false; message: string } {
  // 1. Top-level command error object — present even when status !== 'failed'.
  if (status.error && (status.error.message || status.error.code)) {
    const { code, message } = status.error;
    return { ok: false, message: message ? (code ? `${code}: ${message}` : message) : code };
  }

  const result = status.result;
  if (!result || typeof result !== 'object') {
    return { ok: true };
  }

  const record = result as Record<string, unknown>;

  // 2. Explicit boolean success flags.
  if (record.success === false || record.ok === false || record.loaded === false) {
    return { ok: false, message: extractErrorMessage(record) };
  }

  // 3. Nested status field reporting a failure.
  const innerStatus = typeof record.status === 'string' ? record.status.toLowerCase() : undefined;
  if (innerStatus && /^(fail|failed|failure|error|errored|rejected|invalid)$/.test(innerStatus)) {
    return { ok: false, message: extractErrorMessage(record) };
  }

  // 4. An error / errors payload alongside an otherwise-"completed" command.
  const errText = extractErrorPayload(record);
  if (errText) {
    return { ok: false, message: errText };
  }

  return { ok: true };
}

/** Pull the most human-readable message out of a failing load result payload. */
function extractErrorMessage(record: Record<string, unknown>): string {
  return (
    extractErrorPayload(record) ??
    firstString(record.message, record.error_message, record.errorMessage, record.reason) ??
    'Tableau reported that the workbook load did not complete successfully.'
  );
}

/** Extract text from `error` / `errors` fields, if present. */
function extractErrorPayload(record: Record<string, unknown>): string | undefined {
  const { error, errors } = record;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const msg = firstString(
      (error as Record<string, unknown>).message,
      (error as Record<string, unknown>).text,
    );
    if (msg) return msg;
  }
  if (Array.isArray(errors) && errors.length > 0) {
    const msgs = errors
      .map((e) =>
        typeof e === 'string'
          ? e
          : e && typeof e === 'object'
            ? firstString(
                (e as Record<string, unknown>).message,
                (e as Record<string, unknown>).text,
              )
            : undefined,
      )
      .filter((m): m is string => !!m);
    if (msgs.length > 0) return msgs.join('; ');
  }
  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v;
  }
  return undefined;
}

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
  filePath,
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

  // The External Client API ("Athena V0") whole-workbook POST upserts by sheet name — it overwrites
  // colliding sheets but never removes a live sheet the doc omits. A whole-workbook apply is meant
  // to be authoritative (matching the Agent API's replace), so replaceWorkbook reconciles to the
  // doc's sheet set. The apply lock serializes it against the per-sheet paths' fetch-modify-apply.
  if (getDesktopConfig().externalApiEnabled) {
    const result = await withApplyLock(() => replaceWorkbook({ xml, executor, signal }));
    if (result.isErr()) {
      return Err({ type: 'execute-command-error', error: result.error });
    }
    return Ok({ validationWarnings: validation.issues });
  }

  const result = await loadUnderlyingMetadataByFilepath({ xml, executor, signal, filePath });
  if (result.isErr()) {
    return result;
  }
  // Preflight warnings ride along so apply responses can compute the host
  // verification receipt (W-23447506) without re-running validation.
  return Ok({ validationWarnings: validation.issues });
}

async function loadUnderlyingMetadataByFilepath({
  xml,
  filePath,
  executor,
  signal,
}: {
  xml: string;
  filePath?: string;
} & WithExecutorAndAbortSignal): Promise<LoadHelperResult> {
  let jsonContent: string | undefined;

  try {
    jsonContent = xmlToJson(xml);
  } catch (error) {
    log({
      level: 'warning',
      message: 'XML→JSON conversion failed, falling back to text',
      logger: 'workbookCommands',
      data: {
        error,
      },
    });

    return loadUnderlyingMetadataByText({ xml, executor, signal });
  }

  const jsonPath =
    filePath ||
    new DesktopCache().getCacheFilePath({ prefix: 'workbook-apply', extension: 'json' });
  writeFileSync(jsonPath, jsonContent, 'utf-8');

  log({
    level: 'info',
    message: 'Converted XML→JSON for file-path load',
    logger: 'workbookCommands',
    data: {
      xmlLength: xml.length,
      jsonLength: jsonContent.length,
      filePath: jsonPath,
    },
  });

  const result = await executor.executeCommand({
    namespace: 'tabui',
    command: 'load-underlying-metadata',
    signal,
    args: {
      filepath: jsonPath,
    },
  });

  if (result.isErr()) {
    const { error } = result;
    if (error.type === 'command-failed') {
      log({
        level: 'warning',
        message: 'File-path approach did not complete, falling back to text',
        logger: 'workbookCommands',
        data: {
          error: error.error,
        },
      });

      return loadUnderlyingMetadataByText({ xml, executor, signal });
    }

    return Err({ type: 'execute-command-error', error: result.error });
  }

  // Command completed — but "completed" means the command ran, not that Tableau
  // accepted the document load. A content rejection is surfaced in the payload,
  // so verify the actual load outcome before claiming success. A genuine
  // rejection is NOT retried via text (text would reject identically).
  const outcome = interpretLoadOutcome(result.value);
  if (!outcome.ok) {
    log({
      level: 'error',
      message: 'load-underlying-metadata (filepath/JSON) completed but Tableau rejected the load',
      logger: 'workbookCommands',
      data: { message: outcome.message },
    });

    return Err({
      type: 'load-workbook-xml-error',
      error: { type: 'load-rejected', message: outcome.message },
    });
  }

  log({
    level: 'info',
    message: 'load-underlying-metadata (filepath/JSON) completed',
    logger: 'workbookCommands',
  });

  return Ok.EMPTY;
}

async function loadUnderlyingMetadataByText({
  xml,
  executor,
  signal,
}: {
  xml: string;
} & WithExecutorAndAbortSignal): Promise<LoadHelperResult> {
  const result = await executor.executeCommand({
    namespace: 'tabui',
    command: 'load-underlying-metadata',
    signal,
    args: {
      text: xml,
    },
  });

  if (result.isErr()) {
    const { error } = result;
    if (error.type === 'command-failed') {
      log({
        level: 'error',
        message: 'load-underlying-metadata (text) failed',
        logger: 'workbookCommands',
        data: {
          error,
        },
      });
    }

    return Err({ type: 'execute-command-error', error: result.error });
  }

  // Command completed — verify Tableau actually accepted the load (see the
  // filepath helper for the full rationale). Otherwise a rejected load is a lie.
  const outcome = interpretLoadOutcome(result.value);
  if (!outcome.ok) {
    log({
      level: 'error',
      message: 'load-underlying-metadata (text) completed but Tableau rejected the load',
      logger: 'workbookCommands',
      data: { message: outcome.message },
    });

    return Err({
      type: 'load-workbook-xml-error',
      error: { type: 'load-rejected', message: outcome.message },
    });
  }

  log({
    level: 'info',
    message: 'load-underlying-metadata (text) completed',
    logger: 'workbookCommands',
    data: {
      commandId: result.value.command_id,
      hasResult: !!result.value.result,
      resultKeys: result.value.result ? Object.keys(result.value.result) : [],
    },
  });

  return Ok.EMPTY;
}

// Makes the live workbook match the posted document's sheet set on the External Client API, whose
// POST upserts but never prunes: deletes the live worksheets/dashboards the doc omitted. Two ordering
// rules matter — (1) delete AFTER the POST so every posted sheet is already present and a delete can
// never hit Tableau's refusal to remove the last remaining sheet; (2) delete dashboards BEFORE
// worksheets, because Tableau silently refuses to delete a worksheet still referenced by a live
// dashboard's zone (the refusal returns success, so the worksheet would otherwise survive the prune).
async function replaceWorkbook({
  xml,
  executor,
  signal,
}: { xml: string } & WithExecutorAndAbortSignal): Promise<Result<void, ExecuteCommandError>> {
  const liveResult = await getWorkbookXml({ executor, signal });
  if (liveResult.isErr()) {
    return liveResult;
  }

  let stale: Array<string>;
  try {
    const docSheets = new Set(listSheets(xml));
    const docDashboards = new Set(listWorkbookDashboards(xml));
    const staleDashboards = listWorkbookDashboards(liveResult.value).filter(
      (name) => !docDashboards.has(name),
    );
    const staleSheets = listSheets(liveResult.value).filter((name) => !docSheets.has(name));
    stale = [...staleDashboards, ...staleSheets];
  } catch (error) {
    return Err({ type: 'invalid-response', error });
  }

  const applied = await applyWorkbookText({ xml, executor, signal });
  if (applied.isErr()) {
    return applied;
  }

  for (const name of stale) {
    const deleted = await executor.executeCommand({
      namespace: 'tabdoc',
      command: 'delete-sheet',
      args: { Sheet: name },
      signal,
    });
    if (deleted.isErr()) {
      return deleted;
    }
  }

  return Ok.EMPTY;
}

// Low-level "POST the whole document as text" call shared by the External Client API's
// whole-workbook apply (loadWorkbookXml) and the per-sheet write commands' minimal-doc apply
// (loadWorksheetXml / loadDashboardXml). Not used by the Agent API path, which has its own
// loadUnderlyingMetadataByText above (kept byte-identical to pre-Athena feature/authoring).
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
