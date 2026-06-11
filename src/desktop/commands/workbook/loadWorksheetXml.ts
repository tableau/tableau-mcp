import { Err, Ok, Result } from 'ts-results-es';

import { log } from '../../../logging/logger.js';
import { sanitizeValue } from '../../../logging/sanitize.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { runValidation } from '../../validation/registry.js';
import { ValidationIssue } from '../../validation/types.js';

export type LoadWorksheetXmlError =
  | { type: 'invalid-xml' }
  | { type: 'validation-failed'; issues: Array<ValidationIssue> };

export async function loadWorksheetXml({
  worksheetName,
  xml,
  executor,
  signal,
}: { worksheetName: string; xml: string } & WithExecutorAndAbortSignal): Promise<
  Result<
    void,
    | { type: 'execute-command-error'; error: ExecuteCommandError }
    | { type: 'load-worksheet-xml-error'; error: LoadWorksheetXmlError }
  >
> {
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

function sanitize(value: unknown): unknown {
  return sanitizeValue(value, {
    maxStringLength: 500,
    seen: new WeakSet<object>(),
    depth: 0,
  });
}
