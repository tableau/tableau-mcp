import { writeFileSync } from 'fs';
import { Err, Ok, Result } from 'ts-results-es';

import { getDesktopConfig } from '../../../config.desktop.js';
import { log } from '../../../logging/logger.js';
import { GetCommandStatusResponse } from '../../../sdks/desktop/agentApi/types.js';
import { DesktopCache } from '../../cache.js';
import { xmlToJson } from '../../libraries/workbook-serialization-converter';
import { listWorkbookDashboards } from '../../metadata/dashboards.js';
import { generateUUID } from '../../metadata/parser.js';
import { listSheets } from '../../metadata/sheets.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { runValidation } from '../../validation/registry.js';
import { ValidationIssue } from '../../validation/types.js';
import { withApplyLock } from './applyMutex.js';
import { getWorkbookXml } from './getWorkbookXml.js';

// Name prefix for the throwaway sheet the additive-POST workaround creates. Reads as a progress
// label if it ever flashes in the UI. Callers listing sheets filter it so it never surfaces.
export const SCRATCH_PREFIX = '...thinking-';

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

type LoadWorkbookXmlResult = Result<
  void,
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

  // The External Client API ("Athena V0") whole-workbook POST is additive-only on sheet-name
  // collision (never overwrites), so a straight re-apply duplicates every sheet it already has.
  // That bug — and its scratch-sheet workaround — is specific to that transport; the Agent API
  // path below is untouched.
  if (getDesktopConfig().externalApiEnabled) {
    const result = await withApplyLock(() => resetAndApplyWorkbook({ xml, executor, signal }));
    if (result.isErr()) {
      return Err({ type: 'execute-command-error', error: result.error });
    }
    return Ok.EMPTY;
  }

  return loadUnderlyingMetadataByFilepath({ xml, executor, signal, filePath });
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

// TEMPORARY workaround for an External Client API bug: POST /v1/workbook/document is additive on
// sheet-name collision (never overwrites), so re-posting a whole workbook re-adds every sheet it
// already has as "(2)". The API fix + an expanded get/set surface are coming; remove this then.
// The scratch sheet exists only so the delete loop never hits Tableau's refusal to delete the
// last remaining sheet.
async function resetAndApplyWorkbook({
  xml,
  executor,
  signal,
}: { xml: string } & WithExecutorAndAbortSignal): Promise<Result<void, ExecuteCommandError>> {
  const liveResult = await getWorkbookXml({ executor, signal });
  if (liveResult.isErr()) {
    return liveResult;
  }

  // Only sheets that are BOTH live and in the doc collide on the additive POST. Deleting a
  // doc sheet that is not live yet errors; a live sheet absent from the doc is left to merge.
  let colliding: Array<string>;
  try {
    const docNames = new Set([...listSheets(xml), ...listWorkbookDashboards(xml)]);
    colliding = [
      ...listSheets(liveResult.value),
      ...listWorkbookDashboards(liveResult.value),
    ].filter((name) => docNames.has(name));
  } catch (error) {
    return Err({ type: 'invalid-response', error });
  }

  // Sweep any scratch left over from a prior apply whose trailing delete no-op'd (Tableau silently
  // refuses to delete the last sheet, and the post-POST doc may not have settled yet). Safe because
  // the apply lock serializes us — no live apply owns a scratch right now, and real sheets remain.
  for (const name of listSheets(liveResult.value)) {
    if (name.startsWith(SCRATCH_PREFIX)) {
      await deleteScratch(name, executor, signal);
    }
  }

  const scratchName = `${SCRATCH_PREFIX}${generateUUID().replace(/[^a-zA-Z0-9]/g, '')}`;
  const addScratch = await executor.executeCommand({
    namespace: 'tabdoc',
    command: 'new-worksheet',
    args: { NewSheet: scratchName },
    signal,
  });
  if (addScratch.isErr()) {
    return addScratch;
  }

  for (const name of colliding) {
    const deleted = await executor.executeCommand({
      namespace: 'tabdoc',
      command: 'delete-sheet',
      args: { Sheet: name },
      signal,
    });
    if (deleted.isErr()) {
      await deleteScratch(scratchName, executor, signal);
      return deleted;
    }
  }

  const applied = await applyWorkbookText({ xml, executor, signal });
  if (applied.isErr()) {
    await deleteScratch(scratchName, executor, signal);
    return applied;
  }

  await deleteScratch(scratchName, executor, signal);
  return Ok.EMPTY;
}

async function deleteScratch(
  scratchName: string,
  executor: WithExecutorAndAbortSignal['executor'],
  signal: AbortSignal,
): Promise<Result<void, ExecuteCommandError>> {
  const result = await executor.executeCommand({
    namespace: 'tabdoc',
    command: 'delete-sheet',
    args: { Sheet: scratchName },
    signal,
  });
  if (result.isErr()) {
    return result;
  }
  return Ok.EMPTY;
}

// Low-level "POST the whole document as text" call shared by the External Client API's
// scratch-reset workaround (resetAndApplyWorkbook) and the per-sheet write commands' minimal-doc
// apply (loadWorksheetXml / loadDashboardXml). Not used by the Agent API path, which has its own
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
