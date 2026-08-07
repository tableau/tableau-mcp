import type { ExternalApiToolExecutor } from '../../../../desktop/externalApi/executorTypes.js';
import {
  deleteDashboard,
  listWorkbookDashboards,
} from '../../../../desktop/metadata/dashboards.js';
import {
  findAllWorksheets,
  normalizeArray,
  parseXML,
} from '../../../../desktop/metadata/parser.js';
import type { ParsedWindow } from '../../../../desktop/metadata/types.js';
import { injectTemplate } from '../../../../desktop/templates/injectTemplate.js';
import { targetDashboardInvariantIssues } from '../../../../desktop/validation/targetDashboardInvariant.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import { injectViewpoints } from '../../../../desktop/wrappers/injectViewpoints.js';
import {
  loadWorkbookXml,
  type LoadWorkbookXmlError,
} from '../../../../desktop/wrappers/loadWorkbookXml.js';
import { xmlNamesEqual } from '../../../../desktop/xmlElement.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  IncompleteOperationError,
  type McpToolError,
} from '../../../../errors/mcpToolError.js';
import { getExceptionMessage } from '../../../../utils/getExceptionMessage.js';
import { buildDashboardXml, computeZones, escapeXml } from './dashboardZones.js';

export interface ComposeDashboardCoreArgs {
  dashboardName: string;
  worksheetNames: string[];
  title?: string;
  layout?: {
    layoutType?: 'auto-grid' | 'rows' | 'columns';
    gridColumns?: number;
  };
  executor: ExternalApiToolExecutor;
  signal: AbortSignal;
}

export interface ComposeDashboardReceipt {
  dashboard: string;
  worksheets: string[];
  replaced: boolean;
  verification: { status: 'passed'; issues: [] };
}

export type ComposeDashboardOutcome =
  | { state: 'applied'; retrySafe: false; receipt: ComposeDashboardReceipt }
  | { state: 'failed'; retrySafe: true; stage: string; error: McpToolError }
  | { state: 'partial'; retrySafe: false; stage: string; error: McpToolError }
  | { state: 'unknown'; retrySafe: false; stage: string; error: McpToolError };

export async function composeDashboardCore({
  dashboardName,
  worksheetNames,
  title,
  layout,
  executor,
  signal,
}: ComposeDashboardCoreArgs): Promise<ComposeDashboardOutcome> {
  const inputError = validateComposeDashboardInput(worksheetNames);
  if (inputError) return failed('input-validation', inputError);

  const workbookResult = await getWorkbookXml({ executor, signal });
  if (workbookResult.isErr()) {
    return failed('workbook-read', new DesktopCommandExecutionError(workbookResult.error));
  }

  const pristineXml = workbookResult.value;
  const resolved = resolveRenderedWorksheetNames(pristineXml, worksheetNames);
  const missing = worksheetNames.filter((_, index) => !resolved[index]);
  if (missing.length > 0) {
    return failed(
      'input-validation',
      new ArgsValidationError(
        `Missing live rendered worksheet name(s): ${missing.map((name) => `"${name}"`).join(', ')}.`,
      ),
    );
  }
  const canonicalWorksheetNames = resolved as string[];
  const existingDashboardName = listWorkbookDashboards(pristineXml).find((name) =>
    xmlNamesEqual(name, dashboardName),
  );

  if (!existingDashboardName) {
    return await createDashboard({
      baselineXml: pristineXml,
      expectedWorkbookXml: pristineXml,
      dashboardName,
      worksheetNames: canonicalWorksheetNames,
      title,
      layout,
      executor,
      signal,
      replaced: false,
    });
  }

  const deleteCandidateXml = deleteDashboard(pristineXml, existingDashboardName);
  const deleteResult = await loadWorkbookXml({
    xml: deleteCandidateXml,
    baselineXml: pristineXml,
    expectedWorkbookXml: pristineXml,
    focus: { navigate: 'none', reason: 'intermediate-leg' },
    executor,
    signal,
  });
  if (deleteResult.isErr()) {
    return loadFailureOutcome({
      error: deleteResult.error,
      dashboardName,
      worksheetNames: canonicalWorksheetNames,
      retryableStage: 'pre-dispatch-workbook-drift',
      uncertainStage: 'replace-delete',
    });
  }

  const deleteReadback = await getWorkbookXml({ executor, signal });
  if (deleteReadback.isErr()) {
    return unknown(
      'replace-delete-readback',
      recoveryError({
        applied: 'unknown',
        retrySafe: false,
        dashboard: dashboardName,
        worksheets: canonicalWorksheetNames,
        stage: 'replace-delete-readback',
        apply_error: JSON.stringify(deleteReadback.error),
        guidance:
          'The old dashboard was deleted, but its readback failed. Inspect live state before rebuilding it.',
      }),
    );
  }

  const absenceIssues = dashboardAbsenceIssues(deleteReadback.value, dashboardName);
  if (absenceIssues.length > 0) {
    return unknown(
      'replace-delete-readback',
      recoveryError({
        applied: 'unknown',
        retrySafe: false,
        dashboard: dashboardName,
        worksheets: canonicalWorksheetNames,
        stage: 'replace-delete-readback',
        verificationIssues: absenceIssues,
        guidance:
          'The delete completed but readback still contains the old dashboard. Inspect live state before retrying.',
      }),
    );
  }

  return await createDashboard({
    baselineXml: deleteReadback.value,
    expectedWorkbookXml: deleteReadback.value,
    dashboardName,
    worksheetNames: canonicalWorksheetNames,
    title,
    layout,
    executor,
    signal,
    replaced: true,
  });
}

async function createDashboard({
  baselineXml,
  expectedWorkbookXml,
  dashboardName,
  worksheetNames,
  title,
  layout,
  executor,
  signal,
  replaced,
}: Omit<ComposeDashboardCoreArgs, 'worksheetNames'> & {
  baselineXml: string;
  expectedWorkbookXml: string;
  worksheetNames: string[];
  replaced: boolean;
}): Promise<ComposeDashboardOutcome> {
  let candidateXml: string;
  try {
    const zones = computeZones(title, {
      kpis: [],
      charts: worksheetNames,
      layoutType: layout?.layoutType ?? 'auto-grid',
      gridColumns: layout?.gridColumns,
    });
    const dashboardXml = buildDashboardXml(dashboardName, zones);
    const wrapperXml = `<workbook><dashboards>${dashboardXml}</dashboards><windows><window class="dashboard" name="${escapeXml(dashboardName)}"/></windows></workbook>`;
    candidateXml = injectTemplate(baselineXml, wrapperXml, 'dashboard');
    candidateXml = injectViewpoints(candidateXml, dashboardName, worksheetNames);
  } catch (error) {
    const composeError = new ArgsValidationError(
      `Could not compose dashboard candidate: ${getExceptionMessage(error)}`,
    );
    if (!replaced) return failed('candidate-build', composeError);
    return partial(
      'replace-create',
      recoveryError({
        applied: 'partial',
        retrySafe: false,
        dashboard: dashboardName,
        worksheets: worksheetNames,
        stage: 'replace-create',
        apply_error: composeError.message,
        guidance:
          'The old dashboard was deleted, but the replacement could not be built. Inspect live state before any retry.',
      }),
    );
  }

  const candidateIssues = targetDashboardInvariantIssues(
    candidateXml,
    dashboardName,
    worksheetNames,
  );
  if (candidateIssues.length > 0) {
    const error = recoveryError({
      applied: replaced ? 'partial' : false,
      retrySafe: !replaced,
      dashboard: dashboardName,
      worksheets: worksheetNames,
      stage: replaced ? 'replace-create' : 'preflight-invariant',
      verificationIssues: candidateIssues.map((issue) => issue.message),
    });
    return replaced ? partial('replace-create', error) : failed('preflight-invariant', error);
  }

  const applyResult = await loadWorkbookXml({
    xml: candidateXml,
    baselineXml,
    expectedWorkbookXml,
    focus: { navigate: 'artifact', sheetName: dashboardName },
    executor,
    signal,
  });
  if (applyResult.isErr()) {
    if (replaced) {
      return partial(
        'replace-create',
        recoveryError({
          applied: 'partial',
          retrySafe: false,
          dashboard: dashboardName,
          worksheets: worksheetNames,
          stage: 'replace-create',
          apply_error: describeApplyError(applyResult.error),
          guidance:
            'The old dashboard was deleted, but recreation did not complete. Inspect live state before any retry.',
        }),
      );
    }
    return loadFailureOutcome({
      error: applyResult.error,
      dashboardName,
      worksheetNames,
      retryableStage: 'pre-dispatch-workbook-drift',
      uncertainStage: 'apply',
    });
  }

  const readbackResult = await getWorkbookXml({ executor, signal });
  if (readbackResult.isErr()) {
    const error = recoveryError({
      applied: replaced ? 'partial' : 'unknown',
      retrySafe: false,
      dashboard: dashboardName,
      worksheets: worksheetNames,
      stage: replaced ? 'replace-create' : 'post-apply-read',
      apply_error: JSON.stringify(readbackResult.error),
      guidance:
        'Inspect the live workbook before retrying; the dashboard write may already have landed.',
    });
    return replaced ? partial('replace-create', error) : unknown('post-apply-read', error);
  }

  const readbackIssues = targetDashboardInvariantIssues(
    readbackResult.value,
    dashboardName,
    worksheetNames,
  ).map((issue) => issue.message);
  const targetCount = listWorkbookDashboards(readbackResult.value).filter((name) =>
    xmlNamesEqual(name, dashboardName),
  ).length;
  if (targetCount !== 1) {
    readbackIssues.push(
      `Expected exactly one dashboard named "${dashboardName}" after apply; found ${targetCount}.`,
    );
  }
  if (readbackIssues.length > 0) {
    const error = recoveryError({
      applied: replaced ? 'partial' : 'unknown',
      retrySafe: false,
      dashboard: dashboardName,
      worksheets: worksheetNames,
      stage: replaced ? 'replace-create' : 'readback-verification',
      apply_error: 'Post-apply structural verification did not match the request.',
      verificationIssues: readbackIssues,
      guidance:
        'Call list-dashboards and get-workbook-inventory to inspect live state before retrying; use activate-sheet to inspect the target dashboard.',
    });
    return replaced ? partial('replace-create', error) : unknown('readback-verification', error);
  }

  return {
    state: 'applied',
    retrySafe: false,
    receipt: {
      dashboard: dashboardName,
      worksheets: worksheetNames,
      replaced,
      verification: { status: 'passed', issues: [] },
    },
  };
}

function loadFailureOutcome({
  error,
  dashboardName,
  worksheetNames,
  retryableStage,
  uncertainStage,
}: {
  error: Awaited<ReturnType<typeof loadWorkbookXml>> extends infer R
    ? R extends { error: infer E }
      ? E
      : never
    : never;
  dashboardName: string;
  worksheetNames: string[];
  retryableStage: string;
  uncertainStage: string;
}): ComposeDashboardOutcome {
  if (
    error.type === 'load-workbook-xml-error' &&
    (error.error.type === 'workbook-drift' || error.error.type !== 'load-rejected')
  ) {
    const stage =
      error.error.type === 'workbook-drift' ? retryableStage : 'pre-dispatch-validation';
    return failed(
      stage,
      recoveryError({
        applied: false,
        retrySafe: true,
        dashboard: dashboardName,
        worksheets: worksheetNames,
        stage,
        apply_error: describeWorkbookLoadError(error.error),
      }),
    );
  }
  return unknown(
    uncertainStage,
    recoveryError({
      applied: 'unknown',
      retrySafe: false,
      dashboard: dashboardName,
      worksheets: worksheetNames,
      stage: uncertainStage,
      apply_error: describeApplyError(error),
      guidance:
        'Call list-dashboards and get-workbook-inventory to inspect live state before retrying; use activate-sheet to inspect the target dashboard.',
    }),
  );
}

function dashboardAbsenceIssues(workbookXml: string, dashboardName: string): string[] {
  const issues: string[] = [];
  const dashboards = listWorkbookDashboards(workbookXml).filter((name) =>
    xmlNamesEqual(name, dashboardName),
  );
  if (dashboards.length > 0) {
    issues.push(`Dashboard "${dashboardName}" still exists after its delete apply.`);
  }
  const workbook = parseXML(workbookXml);
  const windows = normalizeArray<ParsedWindow>(workbook.workbook?.windows?.window).filter(
    (window) =>
      window['@_class'] === 'dashboard' &&
      typeof window['@_name'] === 'string' &&
      xmlNamesEqual(window['@_name'], dashboardName),
  );
  if (windows.length > 0) {
    issues.push(`Dashboard window "${dashboardName}" still exists after its delete apply.`);
  }
  return issues;
}

export function validateComposeDashboardInput(
  worksheetNames: string[],
): ArgsValidationError | undefined {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const name of worksheetNames) {
    const normalized = name.normalize('NFC');
    if (seen.has(normalized)) duplicates.add(name);
    seen.add(normalized);
  }
  if (duplicates.size === 0) return undefined;
  return new ArgsValidationError(
    `Duplicate worksheet name(s): ${[...duplicates].map((name) => `"${name}"`).join(', ')}.`,
  );
}

export function resolveRenderedWorksheetNames(
  workbookXml: string,
  requestedNames: string[],
): Array<string | undefined> {
  const workbook = parseXML(workbookXml);
  const worksheetNames = findAllWorksheets(workbook).map((worksheet) => worksheet['@_name']);
  const worksheetWindowNames = normalizeArray<ParsedWindow>(workbook.workbook?.windows?.window)
    .filter((window) => window['@_class'] === 'worksheet')
    .map((window) => window['@_name']);
  return requestedNames.map((requestedName) =>
    worksheetNames.find(
      (worksheetName) =>
        xmlNamesEqual(worksheetName, requestedName) &&
        worksheetWindowNames.some((windowName) => xmlNamesEqual(windowName, worksheetName)),
    ),
  );
}

function describeApplyError(error: Parameters<typeof loadFailureOutcome>[0]['error']): string {
  return error.type === 'load-workbook-xml-error'
    ? describeWorkbookLoadError(error.error)
    : JSON.stringify(error.error);
}

function describeWorkbookLoadError(error: LoadWorkbookXmlError): string {
  if (error.type === 'validation-failed') {
    return error.issues.map((issue) => issue.message).join('; ');
  }
  if (error.type === 'load-rejected') return error.message;
  if (error.type === 'workbook-drift') {
    return 'The workbook changed while the dashboard was being prepared. Re-read and retry.';
  }
  return 'Invalid workbook content.';
}

function recoveryError(payload: Record<string, unknown>): McpToolError {
  return new IncompleteOperationError(payload);
}

function failed(stage: string, error: McpToolError): ComposeDashboardOutcome {
  return { state: 'failed', retrySafe: true, stage, error };
}

function partial(stage: string, error: McpToolError): ComposeDashboardOutcome {
  return { state: 'partial', retrySafe: false, stage, error };
}

function unknown(stage: string, error: McpToolError): ComposeDashboardOutcome {
  return { state: 'unknown', retrySafe: false, stage, error };
}
