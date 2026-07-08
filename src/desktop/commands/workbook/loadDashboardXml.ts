import { Err, Ok, Result } from 'ts-results-es';

import { log } from '../../../logging/logger.js';
import { sanitizeValue } from '../../../logging/sanitize.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { runValidation } from '../../validation/registry.js';
import { ValidationIssue } from '../../validation/types.js';
import { interpretLoadOutcome } from './loadWorkbookXml.js';

export type LoadDashboardXmlError =
  | { type: 'invalid-xml' }
  | { type: 'validation-failed'; issues: Array<ValidationIssue> }
  // The load-dashboard command reported command-level completion, but Tableau
  // rejected the actual document load (surfaced in the response payload, not in
  // `status`). `message` carries Desktop's own error text.
  | { type: 'load-rejected'; message: string };

export async function loadDashboardXml({
  dashboardName,
  xml,
  executor,
  signal,
}: { dashboardName: string; xml: string } & WithExecutorAndAbortSignal): Promise<
  Result<
    void,
    | { type: 'execute-command-error'; error: ExecuteCommandError }
    | { type: 'load-dashboard-xml-error'; error: LoadDashboardXmlError }
  >
> {
  xml = xml.trim();
  if (!xml || (!xml.startsWith('<?xml') && !xml.startsWith('<'))) {
    return Err({ type: 'load-dashboard-xml-error', error: { type: 'invalid-xml' } });
  }

  const validation = runValidation(xml, 'dashboard');
  if (!validation.valid) {
    log({
      level: 'error',
      message: 'Preflight validation failed — dashboard XML not sent to Tableau',
      logger: 'dashboardCommands',
      data: {
        dashboardName,
        issues: validation.issues,
        xmlPreview: sanitize(xml),
      },
    });

    return Err({
      type: 'load-dashboard-xml-error',
      error: { type: 'validation-failed', issues: validation.issues },
    });
  }

  if (validation.issues.length > 0) {
    log({
      level: 'warning',
      message: 'Preflight validation warnings (continuing)',
      logger: 'dashboardCommands',
      data: {
        dashboardName,
        issues: validation.issues,
        xmlPreview: sanitize(xml),
      },
    });
  }

  const result = await executor.executeCommand({
    namespace: 'tabui',
    command: 'load-dashboard',
    signal,
    args: {
      dashboardName,
      dashboardXml: xml,
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
      message: 'load-dashboard completed but Tableau rejected the load',
      logger: 'dashboardCommands',
      data: { dashboardName, message: outcome.message },
    });

    return Err({
      type: 'load-dashboard-xml-error',
      error: { type: 'load-rejected', message: outcome.message },
    });
  }

  log({
    level: 'info',
    message: 'load-dashboard completed',
    logger: 'dashboardCommands',
    data: {
      dashboardName,
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
