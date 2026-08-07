import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

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
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
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
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { getExceptionMessage } from '../../../../utils/getExceptionMessage.js';
import { sessionParam } from '../../params.js';
import { jsonToolResult, type StructuredResult } from '../../structuredContent.js';
import { DesktopTool } from '../../tool.js';
import { buildDashboardXml, computeZones, escapeXml } from './dashboardZones.js';

const layoutSchema = z.object({
  layoutType: z.enum(['auto-grid', 'rows', 'columns']).optional().default('auto-grid'),
  gridColumns: z.number().int().min(1).max(6).optional(),
});

const paramsSchema = {
  session: sessionParam(),
  dashboardName: z.string().trim().min(1).max(255).describe('Dashboard name.'),
  worksheetNames: z
    .array(z.string().trim().min(1).max(255))
    .min(1)
    .max(6)
    .describe('Rendered worksheet names (1-6).'),
  title: z.string().trim().min(1).max(255).optional().describe('Optional title.'),
  layout: layoutSchema.optional().describe('Layout.'),
};

type ComposeDashboardSuccess = {
  applied: true;
  retrySafe: false;
  dashboard: string;
  worksheets: string[];
  replaced: boolean;
  verification: { status: 'passed'; issues: [] };
};

type ComposeDashboardResult = StructuredResult<ComposeDashboardSuccess>;

const title = 'Compose dashboard';

export const getComposeDashboardTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'compose-dashboard',
    title,
    description: 'Build dashboard from live worksheets.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    callback: async (
      { session, dashboardName, worksheetNames, title: titleText, layout },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute<ComposeDashboardResult>({
        extra,
        args: { session, dashboardName, worksheetNames, title: titleText, layout },
        callback: async () => {
          const duplicateNames = duplicateWorksheetNames(worksheetNames);
          if (duplicateNames.length > 0) {
            return new ArgsValidationError(
              `Duplicate worksheet name(s): ${duplicateNames.map((name) => `"${name}"`).join(', ')}.`,
            ).toErr();
          }

          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) return sessionResult.error.toErr();
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);

          const workbookResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (workbookResult.isErr()) {
            return new DesktopCommandExecutionError(workbookResult.error).toErr();
          }
          const pristineXml = workbookResult.value;
          const resolvedWorksheetNames = resolveRenderedWorksheetNames(pristineXml, worksheetNames);
          const missing = worksheetNames.filter((_, index) => !resolvedWorksheetNames[index]);
          if (missing.length > 0) {
            return new ArgsValidationError(
              `Missing live rendered worksheet name(s): ${missing.map((name) => `"${name}"`).join(', ')}.`,
            ).toErr();
          }
          const canonicalWorksheetNames = resolvedWorksheetNames as string[];

          let candidateXml = pristineXml;
          const existingDashboardName = listWorkbookDashboards(candidateXml).find((name) =>
            xmlNamesEqual(name, dashboardName),
          );
          if (existingDashboardName) {
            candidateXml = deleteDashboard(candidateXml, existingDashboardName);
          }

          const zones = computeZones(titleText, {
            kpis: [],
            charts: canonicalWorksheetNames,
            layoutType: layout?.layoutType ?? 'auto-grid',
            gridColumns: layout?.gridColumns,
          });
          const dashboardXml = buildDashboardXml(dashboardName, zones);
          const wrapperXml = `<workbook><dashboards>${dashboardXml}</dashboards><windows><window class="dashboard" name="${escapeXml(dashboardName)}"/></windows></workbook>`;
          try {
            candidateXml = injectTemplate(candidateXml, wrapperXml, 'dashboard');
            candidateXml = injectViewpoints(candidateXml, dashboardName, canonicalWorksheetNames);
          } catch (error) {
            return new ArgsValidationError(
              `Could not compose dashboard candidate: ${getExceptionMessage(error)}`,
            ).toErr();
          }

          const candidateIssues = targetDashboardInvariantIssues(
            candidateXml,
            dashboardName,
            canonicalWorksheetNames,
          );
          if (candidateIssues.length > 0) {
            return new IncompleteOperationError({
              applied: false,
              retrySafe: true,
              dashboard: dashboardName,
              worksheets: canonicalWorksheetNames,
              stage: 'preflight-invariant',
              verificationIssues: candidateIssues.map((issue) => issue.message),
            }).toErr();
          }

          const applyResult = await loadWorkbookXml({
            xml: candidateXml,
            baselineXml: pristineXml,
            expectedWorkbookXml: pristineXml,
            focus: { navigate: 'artifact', sheetName: dashboardName },
            executor,
            signal: extra.signal,
          });
          if (applyResult.isErr()) {
            if (
              applyResult.error.type === 'load-workbook-xml-error' &&
              applyResult.error.error.type === 'workbook-drift'
            ) {
              return new IncompleteOperationError({
                applied: false,
                retrySafe: true,
                dashboard: dashboardName,
                worksheets: canonicalWorksheetNames,
                stage: 'pre-dispatch-workbook-drift',
                apply_error: describeWorkbookLoadError(applyResult.error.error),
              }).toErr();
            }
            if (
              applyResult.error.type === 'load-workbook-xml-error' &&
              applyResult.error.error.type !== 'load-rejected'
            ) {
              return new IncompleteOperationError({
                applied: false,
                retrySafe: true,
                dashboard: dashboardName,
                worksheets: canonicalWorksheetNames,
                stage: 'pre-dispatch-validation',
                apply_error: describeWorkbookLoadError(applyResult.error.error),
              }).toErr();
            }
            return uncertainResult({
              dashboardName,
              worksheetNames: canonicalWorksheetNames,
              stage: 'apply',
              applyError:
                applyResult.error.type === 'load-workbook-xml-error'
                  ? describeWorkbookLoadError(applyResult.error.error)
                  : JSON.stringify(applyResult.error.error),
            });
          }

          const readbackResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (readbackResult.isErr()) {
            return uncertainResult({
              dashboardName,
              worksheetNames: canonicalWorksheetNames,
              stage: 'post-apply-read',
              applyError: JSON.stringify(readbackResult.error),
            });
          }

          const readbackIssues = targetDashboardInvariantIssues(
            readbackResult.value,
            dashboardName,
            canonicalWorksheetNames,
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
            return uncertainResult({
              dashboardName,
              worksheetNames: canonicalWorksheetNames,
              stage: 'readback-verification',
              applyError: 'Post-apply structural verification did not match the request.',
              verificationIssues: readbackIssues,
            });
          }

          return Ok({
            applied: true,
            retrySafe: false,
            dashboard: dashboardName,
            worksheets: canonicalWorksheetNames,
            replaced: existingDashboardName !== undefined,
            verification: { status: 'passed', issues: [] },
          });
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
    },
  });

  return tool;
};

function duplicateWorksheetNames(worksheetNames: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const name of worksheetNames) {
    const normalized = name.normalize('NFC');
    if (seen.has(normalized)) duplicates.add(name);
    seen.add(normalized);
  }
  return [...duplicates];
}

function resolveRenderedWorksheetNames(
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

function uncertainResult({
  dashboardName,
  worksheetNames,
  stage,
  applyError,
  verificationIssues,
}: {
  dashboardName: string;
  worksheetNames: string[];
  stage: 'apply' | 'post-apply-read' | 'readback-verification';
  applyError: string;
  verificationIssues?: string[];
}): ReturnType<IncompleteOperationError<object>['toErr']> {
  return new IncompleteOperationError({
    applied: 'unknown',
    retrySafe: false,
    dashboard: dashboardName,
    worksheets: worksheetNames,
    stage,
    apply_error: applyError,
    ...(verificationIssues ? { verificationIssues } : {}),
    guidance:
      'Call list-dashboards and get-workbook-inventory to inspect live state before retrying; ' +
      'use activate-sheet to inspect the target dashboard.',
  }).toErr();
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
