import { Err, Ok, Result } from 'ts-results-es';

import { getDesktopConfig } from '../../../config.desktop.js';
import { log } from '../../../logging/logger.js';
import { sanitizeValue } from '../../../logging/sanitize.js';
import { buildMinimalDashboardDoc } from '../../metadata/dashboards.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { runValidation } from '../../validation/registry.js';
import { ValidationIssue } from '../../validation/types.js';
import { withApplyLock } from './applyMutex.js';
import { deleteLiveSheet } from './deleteLiveSheet.js';
import { getWorkbookXml } from './getWorkbookXml.js';
import { applyWorkbookText } from './loadWorkbookXml.js';

export type LoadDashboardXmlError =
  | { type: 'invalid-xml' }
  | { type: 'validation-failed'; issues: Array<ValidationIssue> };

type LoadDashboardXmlResult = Result<
  void,
  | { type: 'execute-command-error'; error: ExecuteCommandError }
  | { type: 'load-dashboard-xml-error'; error: LoadDashboardXmlError }
>;

export async function loadDashboardXml({
  dashboardName,
  xml,
  executor,
  signal,
}: {
  dashboardName: string;
  xml: string;
} & WithExecutorAndAbortSignal): Promise<LoadDashboardXmlResult> {
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

  // External Client API ("Athena V0") exposes no per-sheet route — tabui:load-dashboard is not
  // in its command registry, and the whole-workbook POST is additive-only, so applying a single
  // dashboard has to delete the live copy first and re-post a minimal whole-workbook document.
  return getDesktopConfig().externalApiEnabled
    ? loadDashboardXmlViaExternalApi({ dashboardName, xml, executor, signal })
    : loadDashboardXmlViaAgentApi({ dashboardName, xml, executor, signal });
}

async function loadDashboardXmlViaAgentApi({
  dashboardName,
  xml,
  executor,
  signal,
}: {
  dashboardName: string;
  xml: string;
} & WithExecutorAndAbortSignal): Promise<LoadDashboardXmlResult> {
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

async function loadDashboardXmlViaExternalApi({
  dashboardName,
  xml,
  executor,
  signal,
}: {
  dashboardName: string;
  xml: string;
} & WithExecutorAndAbortSignal): Promise<LoadDashboardXmlResult> {
  return withApplyLock(async () => {
    const workbookResult = await getWorkbookXml({ executor, signal });
    if (workbookResult.isErr()) {
      return Err({ type: 'execute-command-error', error: workbookResult.error });
    }

    let minimalDoc: string;
    try {
      minimalDoc = buildMinimalDashboardDoc(workbookResult.value, dashboardName, xml);
    } catch (error) {
      return Err({ type: 'execute-command-error', error: { type: 'invalid-response', error } });
    }

    const deleteResult = await deleteLiveSheet({ sheetName: dashboardName, executor, signal });
    if (deleteResult.isErr()) {
      return Err({ type: 'execute-command-error', error: deleteResult.error });
    }

    const applyResult = await applyWorkbookText({ xml: minimalDoc, executor, signal });
    if (applyResult.isErr()) {
      return Err({ type: 'execute-command-error', error: applyResult.error });
    }

    log({
      level: 'info',
      message: 'load-dashboard completed',
      logger: 'dashboardCommands',
      data: { dashboardName },
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
