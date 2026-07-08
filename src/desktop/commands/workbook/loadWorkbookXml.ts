import { writeFileSync } from 'fs';
import { Err, Ok, Result } from 'ts-results-es';

import { getDesktopConfig } from '../../../config.desktop.js';
import { log } from '../../../logging/logger.js';
import { DesktopCache } from '../../cache.js';
import { xmlToJson } from '../../libraries/workbook-serialization-converter';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { runValidation } from '../../validation/registry.js';
import { ValidationIssue } from '../../validation/types.js';
import { withApplyLock } from './applyMutex.js';

export type LoadWorkbookXmlError =
  | { type: 'invalid-xml' }
  | { type: 'validation-failed'; issues: Array<ValidationIssue> };

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

  // The External Client API ("Athena V0") whole-workbook POST upserts by sheet name: colliding
  // sheets are overwritten in place and live sheets absent from the doc are left untouched. The
  // apply lock serializes this against the per-sheet paths' fetch-modify-apply on the same transport.
  if (getDesktopConfig().externalApiEnabled) {
    const result = await withApplyLock(() => applyWorkbookText({ xml, executor, signal }));
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
} & WithExecutorAndAbortSignal): Promise<
  Result<void, { type: 'execute-command-error'; error: ExecuteCommandError }>
> {
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
} & WithExecutorAndAbortSignal): Promise<
  Result<void, { type: 'execute-command-error'; error: ExecuteCommandError }>
> {
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
