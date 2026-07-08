import { Err, Ok, Result } from 'ts-results-es';

import { log } from '../../../logging/logger.js';
import { listWorkbookDashboards } from '../../metadata/dashboards.js';
import { generateUUID } from '../../metadata/parser.js';
import { listSheets } from '../../metadata/sheets.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { runValidation } from '../../validation/registry.js';
import { ValidationIssue } from '../../validation/types.js';
import { getWorkbookXml } from './getWorkbookXml.js';

export type LoadWorkbookXmlError =
  | { type: 'invalid-xml' }
  | { type: 'validation-failed'; issues: Array<ValidationIssue> };

export async function loadWorkbookXml({
  xml,
  executor,
  signal,
}: { xml: string } & WithExecutorAndAbortSignal): Promise<
  Result<
    void,
    | { type: 'execute-command-error'; error: ExecuteCommandError }
    | { type: 'load-workbook-xml-error'; error: LoadWorkbookXmlError }
  >
> {
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

  const result = await resetAndApplyWorkbook({ xml, executor, signal });
  if (result.isErr()) {
    return Err({ type: 'execute-command-error', error: result.error });
  }

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

  const scratchName = `mcpApplyScratch${generateUUID().replace(/[^a-zA-Z0-9]/g, '')}`;
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

  return deleteScratch(scratchName, executor, signal);
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
