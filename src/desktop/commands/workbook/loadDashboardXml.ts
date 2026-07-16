import { Err, Ok, Result } from 'ts-results-es';

import { getDesktopConfig } from '../../../config.desktop.js';
import { log } from '../../../logging/logger.js';
import { sanitizeValue } from '../../../logging/sanitize.js';
import { buildMinimalDashboardDoc } from '../../metadata/dashboards.js';
import { normalizeArray, parseXML } from '../../metadata/parser.js';
import type { ParsedDashboard } from '../../metadata/types.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { runValidation } from '../../validation/registry.js';
import { ValidationIssue } from '../../validation/types.js';
import { formatApplyFailureForAgent } from './applyFailureClassifier.js';
import { withApplyLock } from './applyMutex.js';
import { focusAppliedSheetBestEffort } from './focusAppliedSheet.js';
import { getWorkbookXml } from './getWorkbookXml.js';
import { applyWorkbookText, interpretLoadOutcome } from './loadWorkbookXml.js';

export type LoadDashboardXmlError =
  | { type: 'invalid-xml' }
  | { type: 'validation-failed'; issues: Array<ValidationIssue> }
  // The caller's dashboard_name disagrees with the `<dashboard name>` in the authored XML, or the
  // payload carries no top-level `<dashboard>` fragment to gate on (e.g. a whole `<workbook>`
  // document). Caught BEFORE apply so the post-apply goto-sheet can never target a stale/default
  // sheet, and so the agent gets an actionable message instead of a misleading empty-name mismatch.
  | { type: 'name-mismatch'; message: string }
  // The load-dashboard command reported command-level completion, but Tableau
  // rejected the actual document load (surfaced in the response payload, not in
  // `status`). `message` carries Desktop's own error text.
  | { type: 'load-rejected'; message: string };

export interface LoadDashboardXmlOk {
  validationWarnings: ValidationIssue[];
}

type LoadDashboardXmlResult = Result<
  LoadDashboardXmlOk,
  | { type: 'execute-command-error'; error: ExecuteCommandError }
  | { type: 'load-dashboard-xml-error'; error: LoadDashboardXmlError }
>;

type LoadDashboardHelperResult = Result<
  void,
  | { type: 'execute-command-error'; error: ExecuteCommandError }
  | { type: 'load-dashboard-xml-error'; error: LoadDashboardXmlError }
>;

/**
 * Canonical-name gate. The `<dashboard name>` in the authored XML is the identity Tableau
 * applies, so require the caller's `dashboardName` to agree with it before we touch Desktop.
 * Names are compared after trim and Unicode NFC normalization (case-sensitive) so visually
 * identical NFD/NFC spellings do not false-mismatch. Returns the validated canonical name — the
 * name exactly as authored in the XML (trimmed), which is what Tableau stores when it applies the
 * raw XML — for the load and the post-apply goto-sheet, so focus can never target a stale/default
 * sheet (e.g. "Sheet 1"), and so buildMinimalDashboardDoc's own name check still matches.
 *
 * Only a single top-level `<dashboard>` fragment is a legal payload here (the same fragment
 * get-dashboard-xml returns and buildMinimalDashboardDoc requires). A `<workbook>`-wrapped document
 * has no top-level identity to gate on, so it is rejected before apply with a recovery hint rather
 * than failing as a misleading mismatch against an empty XML name.
 */
function resolveCanonicalDashboardName(
  dashboardName: string,
  xml: string,
): Result<string, Extract<LoadDashboardXmlError, { type: 'name-mismatch' }>> {
  const callerName = dashboardName.trim();
  let xmlName = '';
  let isWorkbookDocument = false;
  try {
    const parsed = parseXML(xml);
    const dashboard = normalizeArray(parsed.dashboard as ParsedDashboard | undefined)[0];
    xmlName = dashboard?.['@_name']?.trim() ?? '';
    isWorkbookDocument = !xmlName && Boolean(parsed.workbook);
  } catch {
    xmlName = '';
  }

  if (!xmlName) {
    // No top-level <dashboard> identity to gate on — reject with an actionable recovery message
    // instead of a misleading mismatch against an empty XML name.
    return Err({
      type: 'name-mismatch',
      message: isWorkbookDocument
        ? 'apply-dashboard expects a single <dashboard name="..."> fragment, but the XML is a whole ' +
          `<workbook> document. FIX: Extract just the <dashboard name="${callerName}"> element and retry ` +
          'with that fragment as dashboardXml — or apply the whole document with apply-workbook.'
        : 'apply-dashboard could not find a top-level <dashboard name="..."> element in the XML. ' +
          `FIX: Provide a single <dashboard name="${callerName}"> fragment (as returned by get-dashboard-xml) ` +
          'as dashboardXml.',
    });
  }

  if (xmlName.normalize('NFC') !== callerName.normalize('NFC')) {
    return Err({
      type: 'name-mismatch',
      message:
        `dashboard_name "${dashboardName}" does not match the <dashboard name> in the XML ("${xmlName}"). ` +
        `FIX: Retry with dashboard_name set to the XML's name "${xmlName}" — or update the <dashboard name> ` +
        `attribute in the XML to "${dashboardName}" if the caller name is intended.`,
    });
  }

  return Ok(xmlName);
}

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

  // Canonical-name gate (focus hardening): require the caller's dashboard_name to agree with
  // the XML root name before apply, then thread the validated canonical name through the load
  // and goto-sheet so navigation can never land on a stale/default sheet.
  const canonicalNameResult = resolveCanonicalDashboardName(dashboardName, xml);
  if (canonicalNameResult.isErr()) {
    log({
      level: 'error',
      message: 'dashboard_name does not match the XML dashboard name — not sent to Tableau',
      logger: 'dashboardCommands',
      data: { dashboardName, message: canonicalNameResult.error.message },
    });
    return Err({ type: 'load-dashboard-xml-error', error: canonicalNameResult.error });
  }
  const canonicalName = canonicalNameResult.value;

  // External Client API ("Athena V0") exposes no per-sheet route — tabui:load-dashboard is not in
  // its command registry, so applying a single dashboard re-posts a minimal whole-workbook document.
  // The POST upserts by name: it overwrites the colliding dashboard in place and leaves the rest live.
  const result = await (getDesktopConfig().externalApiEnabled
    ? loadDashboardXmlViaExternalApi({ dashboardName: canonicalName, xml, executor, signal })
    : loadDashboardXmlViaAgentApi({ dashboardName: canonicalName, xml, executor, signal }));
  if (result.isErr()) {
    return result;
  }
  // Preflight warnings ride along so apply responses can compute the host
  // verification receipt (W-23447506) without re-running validation.
  return Ok({ validationWarnings: validation.issues });
}

async function loadDashboardXmlViaAgentApi({
  dashboardName,
  xml,
  executor,
  signal,
}: {
  dashboardName: string;
  xml: string;
} & WithExecutorAndAbortSignal): Promise<LoadDashboardHelperResult> {
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
      error: {
        type: 'load-rejected',
        message: formatApplyFailureForAgent({
          context: 'dashboard',
          serverError: outcome.message,
          xmlSnippet: xml,
        }),
      },
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

  await focusAppliedSheetBestEffort({
    sheetName: dashboardName,
    appliedVia: 'load-dashboard',
    executor,
    signal,
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
} & WithExecutorAndAbortSignal): Promise<LoadDashboardHelperResult> {
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

    await focusAppliedSheetBestEffort({
      sheetName: dashboardName,
      appliedVia: 'load-dashboard',
      executor,
      signal,
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
