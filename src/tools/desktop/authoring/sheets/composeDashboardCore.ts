import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom';

import type { ExternalApiToolExecutor } from '../../../../desktop/externalApi/executorTypes.js';
import {
  deleteDashboard,
  listWorkbookDashboards,
} from '../../../../desktop/metadata/dashboards.js';
import { classifyWorkbookWorksheets } from '../../../../desktop/metadata/worksheetRenderState.js';
import { injectTemplate } from '../../../../desktop/templates/injectTemplate.js';
import { targetDashboardInvariantIssues } from '../../../../desktop/validation/targetDashboardInvariant.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import { injectViewpoints } from '../../../../desktop/wrappers/injectViewpoints.js';
import {
  loadWorkbookXml,
  type LoadWorkbookXmlError,
} from '../../../../desktop/wrappers/loadWorkbookXml.js';
import { pollReadback } from '../../../../desktop/wrappers/pollReadback.js';
import { parsedXmlNamesEqual, xmlNamesEqual } from '../../../../desktop/xmlElement.js';
import {
  DesktopCommandExecutionError,
  IncompleteOperationError,
} from '../../../../errors/mcpToolError.desktop.js';
import { ArgsValidationError, type McpToolError } from '../../../../errors/mcpToolError.js';
import { getExceptionMessage } from '../../../../utils/getExceptionMessage.js';
import { buildDashboardXml, computeZones, escapeXml } from './dashboardZones.js';

export interface ComposeDashboardLayout {
  layoutType?: 'auto-grid' | 'rows' | 'columns' | 'executive-summary';
  gridColumns?: number;
  kpiWorksheetNames?: string[];
}

export interface ComposeDashboardCoreArgs {
  dashboardName: string;
  worksheetNames: string[];
  title?: string;
  layout?: ComposeDashboardLayout;
  executor: ExternalApiToolExecutor;
  signal: AbortSignal;
}

export interface ComposeDashboardReceipt {
  dashboard: string;
  worksheets: string[];
  replaced: boolean;
  verification: { status: 'passed'; issues: [] };
  warnings?: string[];
}

export interface BuildDashboardCandidateXmlArgs {
  baselineXml: string;
  dashboardName: string;
  canonicalWorksheetNames: string[];
  title?: ComposeDashboardCoreArgs['title'];
  layout?: ComposeDashboardCoreArgs['layout'];
}

export type ComposeDashboardOutcome =
  | { state: 'applied'; retrySafe: false; receipt: ComposeDashboardReceipt }
  | { state: 'failed'; retrySafe: true; stage: string; error: McpToolError }
  | { state: 'unknown'; retrySafe: false; stage: string; error: McpToolError };

export function buildDashboardCandidateXml({
  baselineXml,
  dashboardName,
  canonicalWorksheetNames,
  title,
  layout,
}: BuildDashboardCandidateXmlArgs): string {
  const inputError = validateComposeDashboardInput(canonicalWorksheetNames, layout);
  if (inputError) throw inputError;
  const layoutType = layout?.layoutType;
  const isExecutiveSummary = layoutType === 'executive-summary';
  const kpis = isExecutiveSummary
    ? (layout?.kpiWorksheetNames ?? []).flatMap((kpiName) => {
        const canonicalName = canonicalWorksheetNames.find((name) =>
          parsedXmlNamesEqual(kpiName, name),
        );
        return canonicalName ? [canonicalName] : [];
      })
    : [];
  const charts = canonicalWorksheetNames.filter(
    (name) => !kpis.some((kpiName) => parsedXmlNamesEqual(kpiName, name)),
  );
  const zones = computeZones(title, {
    kpis,
    charts,
    layoutType: isExecutiveSummary ? 'executive-summary' : (layoutType ?? 'auto-grid'),
    gridColumns: layout?.gridColumns,
  });
  const dashboardXml = buildDashboardXml(dashboardName, zones, layoutType ?? 'auto-grid');
  const wrapperXml = `<workbook><dashboards>${dashboardXml}</dashboards><windows><window class="dashboard" name="${escapeXml(dashboardName)}"/></windows></workbook>`;
  const candidateXml = injectTemplate(baselineXml, wrapperXml, 'dashboard');
  return injectViewpoints(candidateXml, dashboardName, canonicalWorksheetNames);
}

export function dashboardCandidateReadbackIssues(
  readbackXml: string,
  candidateXml: string,
  dashboardName: string,
  worksheetNames: string[],
): string[] {
  const issues = targetDashboardInvariantIssues(readbackXml, dashboardName, worksheetNames).map(
    (issue) => issue.message,
  );
  if (issues.length > 0) return issues;

  const expectedShape = dashboardShape(candidateXml, dashboardName);
  const actualShape = dashboardShape(readbackXml, dashboardName);
  if (expectedShape && actualShape && !dashboardShapesEqual(expectedShape, actualShape)) {
    issues.push(
      `Dashboard "${dashboardName}" readback did not match the requested title and layout.`,
    );
  }
  return issues;
}

export async function composeDashboardCore({
  dashboardName,
  worksheetNames,
  title,
  layout,
  executor,
  signal,
}: ComposeDashboardCoreArgs): Promise<ComposeDashboardOutcome> {
  const inputError = validateComposeDashboardInput(worksheetNames, layout);
  if (inputError) return failed('input-validation', inputError);

  const workbookResult = await getWorkbookXml({ executor, signal });
  if (workbookResult.isErr()) {
    return failed('workbook-read', new DesktopCommandExecutionError(workbookResult.error));
  }

  const pristineXml = workbookResult.value;
  const resolved = resolveLiveWorksheetNames(pristineXml, worksheetNames);
  const missing = worksheetNames.filter((_, index) => !resolved[index]);
  if (missing.length > 0) {
    return failed(
      'input-validation',
      new ArgsValidationError(
        `Missing live worksheet name(s): ${missing.map((name) => `"${name}"`).join(', ')}.`,
      ),
    );
  }
  const canonicalWorksheetNames = resolved as string[];
  const emptyWorksheetNames = findBlankWorksheetNames(pristineXml, canonicalWorksheetNames);
  const existingDashboardName = listWorkbookDashboards(pristineXml).find((name) =>
    xmlNamesEqual(name, dashboardName),
  );

  return await createDashboard({
    candidateBaselineXml: existingDashboardName
      ? deleteDashboard(pristineXml, existingDashboardName)
      : pristineXml,
    validationBaselineXml: pristineXml,
    expectedWorkbookXml: pristineXml,
    dashboardName,
    worksheetNames: canonicalWorksheetNames,
    title,
    layout,
    executor,
    signal,
    replaced: existingDashboardName !== undefined,
    emptyWorksheetNames,
  });
}

async function createDashboard({
  candidateBaselineXml,
  validationBaselineXml,
  expectedWorkbookXml,
  dashboardName,
  worksheetNames,
  title,
  layout,
  executor,
  signal,
  replaced,
  emptyWorksheetNames,
}: Omit<ComposeDashboardCoreArgs, 'worksheetNames'> & {
  candidateBaselineXml: string;
  validationBaselineXml: string;
  expectedWorkbookXml: string;
  worksheetNames: string[];
  replaced: boolean;
  emptyWorksheetNames: string[];
}): Promise<ComposeDashboardOutcome> {
  let candidateXml: string;
  try {
    candidateXml = buildDashboardCandidateXml({
      baselineXml: candidateBaselineXml,
      dashboardName,
      canonicalWorksheetNames: worksheetNames,
      title,
      layout,
    });
  } catch (error) {
    const composeError = new ArgsValidationError(
      `Could not compose dashboard candidate: ${getExceptionMessage(error)}`,
    );
    return failed('candidate-build', composeError);
  }

  const candidateIssues = targetDashboardInvariantIssues(
    candidateXml,
    dashboardName,
    worksheetNames,
  );
  if (candidateIssues.length > 0) {
    return failed(
      'preflight-invariant',
      recoveryError({
        applied: false,
        retrySafe: true,
        dashboard: dashboardName,
        worksheets: worksheetNames,
        stage: 'preflight-invariant',
        verificationIssues: candidateIssues.map((issue) => issue.message),
      }),
    );
  }

  const applyResult = await loadWorkbookXml({
    xml: candidateXml,
    baselineXml: validationBaselineXml,
    expectedWorkbookXml,
    focus: { navigate: 'artifact', sheetName: dashboardName },
    executor,
    signal,
  });
  if (applyResult.isErr()) {
    return loadFailureOutcome({
      error: applyResult.error,
      dashboardName,
      worksheetNames,
      retryableStage: 'pre-dispatch-workbook-drift',
      uncertainStage: 'apply',
    });
  }

  const readbackResult = await pollReadback({
    read: () => getWorkbookXml({ executor, signal }),
    settled: (xml) =>
      dashboardCandidateReadbackIssues(xml, candidateXml, dashboardName, worksheetNames).length ===
      0,
    signal,
  });
  if (!readbackResult.ok) {
    const error = recoveryError({
      applied: 'unknown',
      retrySafe: false,
      dashboard: dashboardName,
      worksheets: worksheetNames,
      stage: 'post-apply-read',
      apply_error: new DesktopCommandExecutionError(readbackResult.error).getErrorText(),
      guidance:
        'Inspect the live workbook before retrying; the dashboard write may already have landed.',
    });
    return unknown('post-apply-read', error);
  }

  const readbackIssues = dashboardCandidateReadbackIssues(
    readbackResult.value,
    candidateXml,
    dashboardName,
    worksheetNames,
  );
  if (!readbackResult.settled || readbackIssues.length > 0) {
    const error = recoveryError({
      applied: 'unknown',
      retrySafe: false,
      dashboard: dashboardName,
      worksheets: worksheetNames,
      stage: 'readback-verification',
      apply_error: 'Post-apply structural verification did not match the request.',
      verificationIssues: readbackIssues,
      guidance:
        'Call list-dashboards and get-workbook-inventory to inspect live state before retrying; use activate-sheet to inspect the target dashboard.',
    });
    return unknown('readback-verification', error);
  }

  return {
    state: 'applied',
    retrySafe: false,
    receipt: {
      dashboard: dashboardName,
      worksheets: worksheetNames,
      replaced,
      verification: { status: 'passed', issues: [] },
      ...(emptyWorksheetNames.length > 0
        ? { warnings: [emptyWorksheetWarning(emptyWorksheetNames)] }
        : {}),
    },
  };
}

const DASHBOARD_SHAPE_ATTRIBUTES = [
  'id',
  'type-v2',
  'param',
  'name',
  'x',
  'y',
  'w',
  'h',
  'sizing-mode',
  'minwidth',
  'minheight',
  'maxwidth',
  'maxheight',
  'bold',
  'fontalignment',
  'fontcolor',
  'fontname',
  'fontsize',
] as const;

interface DashboardShapeElement {
  tagName: string;
  attributes: Record<string, string>;
  parentZoneId?: string;
  text?: string;
}

function dashboardShape(
  workbookXml: string,
  dashboardName: string,
): DashboardShapeElement[] | null {
  const doc = new DOMParser({ errorHandler: () => {} }).parseFromString(
    workbookXml.trim() || '<empty/>',
    'text/xml',
  );
  const dashboards = doc.getElementsByTagName('dashboard');
  let dashboard: XmlElement | null = null;
  for (let index = 0; index < dashboards.length; index++) {
    const candidate = dashboards.item(index);
    const name = candidate?.getAttribute('name');
    if (candidate && name && xmlNamesEqual(name, dashboardName)) {
      dashboard = candidate;
      break;
    }
  }
  if (!dashboard) return null;

  return ['size', 'zone', 'run'].flatMap((tagName) => {
    const found = dashboard!.getElementsByTagName(tagName);
    const values: DashboardShapeElement[] = [];
    for (let index = 0; index < found.length; index++) {
      const element = found.item(index);
      if (!element) continue;
      const attributes: Record<string, string> = {};
      for (const attributeName of DASHBOARD_SHAPE_ATTRIBUTES) {
        if (element.hasAttribute(attributeName)) {
          attributes[attributeName] = element.getAttribute(attributeName) ?? '';
        }
      }
      const parent = element.parentNode as XmlElement;
      values.push({
        tagName,
        attributes,
        ...(tagName === 'zone' && parent.tagName === 'zone'
          ? { parentZoneId: parent.getAttribute('id') ?? undefined }
          : {}),
        ...(tagName === 'run' ? { text: element.textContent ?? '' } : {}),
      });
    }
    return values;
  });
}

const ZONE_GEOMETRY_ATTRIBUTES = new Set(['x', 'y', 'w', 'h']);

function dashboardShapesEqual(
  expected: DashboardShapeElement[],
  actual: DashboardShapeElement[],
): boolean {
  if (expected.length !== actual.length) return false;
  return expected.every((expectedElement, index) => {
    const actualElement = actual[index];
    if (
      !actualElement ||
      expectedElement.tagName !== actualElement.tagName ||
      expectedElement.parentZoneId !== actualElement.parentZoneId ||
      expectedElement.text !== actualElement.text
    ) {
      return false;
    }
    const expectedAttributes = Object.keys(expectedElement.attributes);
    const actualAttributes = Object.keys(actualElement.attributes);
    if (
      expectedAttributes.length !== actualAttributes.length ||
      expectedAttributes.some((attributeName) => !(attributeName in actualElement.attributes))
    ) {
      return false;
    }
    return expectedAttributes.every((attributeName) => {
      const expectedValue = expectedElement.attributes[attributeName];
      const actualValue = actualElement.attributes[attributeName];
      if (expectedElement.tagName === 'zone' && ZONE_GEOMETRY_ATTRIBUTES.has(attributeName)) {
        const expectedGeometry = Number(expectedValue);
        const actualGeometry = Number(actualValue);
        return (
          Number.isInteger(expectedGeometry) &&
          Number.isInteger(actualGeometry) &&
          Math.abs(expectedGeometry - actualGeometry) <= 1
        );
      }
      return expectedValue === actualValue;
    });
  });
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

export function validateComposeDashboardInput(
  worksheetNames: string[],
  layout?: ComposeDashboardLayout,
): ArgsValidationError | undefined {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const name of worksheetNames) {
    const normalized = name.normalize('NFC');
    if (seen.has(normalized)) duplicates.add(name);
    seen.add(normalized);
  }
  if (duplicates.size > 0) {
    return new ArgsValidationError(
      `Duplicate worksheet name(s): ${[...duplicates].map((name) => `"${name}"`).join(', ')}.`,
    );
  }

  const requestedKpis = layout?.kpiWorksheetNames ?? [];
  if (layout?.layoutType !== 'executive-summary') {
    return requestedKpis.length > 0
      ? new ArgsValidationError('kpiWorksheetNames requires layoutType "executive-summary".')
      : undefined;
  }
  if (layout.gridColumns !== undefined) {
    return new ArgsValidationError(
      'gridColumns cannot be combined with layoutType "executive-summary".',
    );
  }
  if (requestedKpis.length < 1) {
    return new ArgsValidationError(
      'layoutType "executive-summary" requires at least one KPI worksheet name.',
    );
  }
  const duplicateKpis = requestedKpis.filter(
    (name, index) =>
      requestedKpis.findIndex((candidate) => parsedXmlNamesEqual(candidate, name)) !== index,
  );
  if (duplicateKpis.length > 0) {
    return new ArgsValidationError(
      `Duplicate KPI worksheet name(s): ${[...new Set(duplicateKpis)]
        .map((name) => `"${name}"`)
        .join(', ')}.`,
    );
  }
  const unknownKpis = requestedKpis.filter(
    (name) => !worksheetNames.some((worksheetName) => parsedXmlNamesEqual(worksheetName, name)),
  );
  if (unknownKpis.length > 0) {
    return new ArgsValidationError(
      `Unknown KPI worksheet name(s): ${unknownKpis.map((name) => `"${name}"`).join(', ')}.`,
    );
  }
  if (worksheetNames.length === requestedKpis.length) {
    return new ArgsValidationError(
      'layoutType "executive-summary" requires at least one non-KPI worksheet.',
    );
  }
  return undefined;
}

export function resolveLiveWorksheetNames(
  workbookXml: string,
  requestedNames: string[],
): Array<string | undefined> {
  const { worksheets, worksheetWindowNames } = classifyWorkbookWorksheets(workbookXml);
  return requestedNames.map((requestedName) => {
    const worksheet = worksheets.find(
      (candidate) =>
        parsedXmlNamesEqual(candidate.name, requestedName) &&
        worksheetWindowNames.some((windowName) => parsedXmlNamesEqual(windowName, candidate.name)),
    );
    if (!worksheet) {
      return undefined;
    }
    return worksheet.name;
  });
}

export function findBlankWorksheetNames(workbookXml: string, worksheetNames: string[]): string[] {
  const { worksheets, worksheetWindowNames } = classifyWorkbookWorksheets(workbookXml);
  return worksheetNames.flatMap((worksheetName) => {
    const worksheet = worksheets.find(
      (candidate) =>
        parsedXmlNamesEqual(candidate.name, worksheetName) &&
        worksheetWindowNames.some((windowName) => parsedXmlNamesEqual(windowName, candidate.name)),
    );
    return worksheet?.state === 'blank' ? [worksheet.name] : [];
  });
}

export function emptyWorksheetWarning(worksheetNames: string[]): string {
  if (worksheetNames.length === 1) {
    return `Worksheet "${worksheetNames[0]}" is empty and will display as an empty tile on the dashboard.`;
  }
  return `${worksheetNames.length} worksheets are empty and will display as empty tiles on the dashboard.`;
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

function unknown(stage: string, error: McpToolError): ComposeDashboardOutcome {
  return { state: 'unknown', retrySafe: false, stage, error };
}
