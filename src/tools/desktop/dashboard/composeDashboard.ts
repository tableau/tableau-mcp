import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DOMParser, Element as XmlElement, Node as XmlNode } from '@xmldom/xmldom';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { dispatchApplyFocus } from '../../../desktop/commands/workbook/applyFocus.js';
import { withApplyLock } from '../../../desktop/commands/workbook/applyMutex.js';
import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { injectViewpoints } from '../../../desktop/commands/workbook/injectViewpoints.js';
import { listDashboards } from '../../../desktop/commands/workbook/listDashboards.js';
import { listWorksheets } from '../../../desktop/commands/workbook/listWorksheets.js';
import { loadDashboardXml } from '../../../desktop/commands/workbook/loadDashboardXml.js';
import { loadWorkbookXml } from '../../../desktop/commands/workbook/loadWorkbookXml.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { formatDashboardPromiseCheck } from '../../../desktop/validation/promise-check.js';
import { normalizeXmlName, xmlNamesEqual } from '../../../desktop/xmlElement.js';
import {
  DashboardXmlLoadFailedError,
  DesktopCommandExecutionError,
  McpToolError,
  WorkbookXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';
import { buildDashboardXml, computeZones } from './dashboardZones.js';
import { accountDashboardViewpoints } from './viewpointAccounting.js';

const layoutSchema = z.object({
  layoutType: z
    .enum(['auto-grid', 'rows', 'columns'])
    .optional()
    .default('auto-grid')
    .describe('Layout.'),
  gridColumns: z.number().int().min(1).max(12).optional().describe('Grid columns.'),
});

const paramsSchema = {
  dashboardName: z.string().trim().min(1).describe('New dashboard name.'),
  worksheets: z
    .array(z.string().trim().min(1).describe('Existing worksheet name.'))
    .min(2)
    .max(12)
    .describe('2-12 existing worksheet names.'),
  layout: layoutSchema.optional().describe('Zone layout.'),
  session: z.string().optional().describe('Desktop session ID.'),
};

type WorksheetZoneReceipt = {
  worksheet: string;
  position: { x: number; y: number; width: number; height: number };
};

type ComposeDashboardResult =
  | {
      dashboardName: string;
      zones: WorksheetZoneReceipt[];
      verification: string;
    }
  | {
      dashboardName: string;
      dashboardState: 'unknown';
      attemptedZones: WorksheetZoneReceipt[];
      verification: string;
    };

function terminalError(message: string, type = 'compose-dashboard-refused'): McpToolError {
  return new McpToolError({ type, message, statusCode: 409 });
}

const title = 'Compose Dashboard';

export const getComposeDashboardTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'compose-dashboard',
    title,
    description: 'Compose 2-12 existing sheets; no overwrite.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    callback: async (
      { dashboardName, worksheets, layout, session },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute<ComposeDashboardResult>({
        extra,
        args: { dashboardName, worksheets, layout, session },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return terminalError(
              `${sessionResult.error.message} Next call: list-instances, then call compose-dashboard again with a valid session.`,
              'compose-dashboard-session-error',
            ).toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          const worksheetResult = await listWorksheets({ executor, signal: extra.signal });
          if (worksheetResult.isErr()) {
            const detail = new DesktopCommandExecutionError(worksheetResult.error).message;
            return terminalError(
              `Could not read the live worksheet list (${detail}). Next call: list-worksheets, then call compose-dashboard again.`,
              'compose-dashboard-worksheet-read-error',
            ).toErr();
          }

          const availableWorksheets = worksheetResult.value.worksheets;
          const resolvedWorksheets = worksheets.map((requestedName) =>
            availableWorksheets.find((availableName) =>
              xmlNamesEqual(availableName, requestedName),
            ),
          );
          const missingWorksheets = worksheets.filter(
            (_, index) => resolvedWorksheets[index] === undefined,
          );
          if (missingWorksheets.length > 0) {
            const missing = missingWorksheets.map((name) => `"${name}"`).join(', ');
            const available =
              availableWorksheets.length > 0
                ? availableWorksheets.map((name) => `"${name}"`).join(', ')
                : '(none)';
            return terminalError(
              `Missing worksheets: ${missing}. Available worksheets: ${available}. ` +
                'Next call: compose-dashboard again using only names from Available worksheets.',
              'compose-dashboard-missing-worksheets',
            ).toErr();
          }
          const canonicalWorksheets = resolvedWorksheets as string[];
          const seenWorksheets = new Set<string>();
          for (const worksheet of canonicalWorksheets) {
            const canonicalName = normalizeXmlName(worksheet);
            if (seenWorksheets.has(canonicalName)) {
              return terminalError(
                `Duplicate worksheet "${worksheet}" resolves to the same live worksheet more than once. ` +
                  'Next call: compose-dashboard again with each worksheet listed once.',
                'compose-dashboard-duplicate-worksheet',
              ).toErr();
            }
            seenWorksheets.add(canonicalName);
          }

          const dashboardResult = await listDashboards({ executor, signal: extra.signal });
          if (dashboardResult.isErr()) {
            const detail = new DesktopCommandExecutionError(dashboardResult.error).message;
            return terminalError(
              `Could not read the live dashboard list (${detail}). Next call: list-dashboards, then call compose-dashboard again.`,
              'compose-dashboard-dashboard-read-error',
            ).toErr();
          }

          if (
            dashboardResult.value.dashboards.some((existingName) =>
              xmlNamesEqual(existingName, dashboardName),
            )
          ) {
            return terminalError(
              `Dashboard "${dashboardName}" already exists and was not overwritten. ` +
                'Next call: compose-dashboard again with a new dashboardName.',
              'compose-dashboard-duplicate-dashboard',
            ).toErr();
          }

          const zones = computeZones(undefined, {
            kpis: [],
            charts: canonicalWorksheets,
            layoutType: layout?.layoutType ?? 'auto-grid',
            gridColumns: layout?.gridColumns,
          });
          const dashboardXml = buildDashboardXml(dashboardName, zones);
          const applyResult = await loadDashboardXml({
            dashboardName,
            xml: dashboardXml,
            focus: { navigate: 'none', reason: 'intermediate-leg' },
            executor,
            signal: extra.signal,
          });
          if (applyResult.isErr()) {
            const detail =
              applyResult.error.type === 'execute-command-error'
                ? new DesktopCommandExecutionError(applyResult.error.error).message
                : new DashboardXmlLoadFailedError(applyResult.error.error).message;
            return terminalError(
              `Dashboard "${dashboardName}" was not confirmed applied (${detail}). ` +
                'Next call: list-dashboards to check whether it exists before retrying compose-dashboard.',
              'compose-dashboard-apply-error',
            ).toErr();
          }
          const validationWarnings = [...applyResult.value.validationWarnings];
          const worksheetZones: WorksheetZoneReceipt[] = zones
            .filter((zone) => zone.kind === 'worksheet')
            .map((zone) => ({
              worksheet: zone.name,
              position: {
                x: zone.x,
                y: zone.y,
                width: zone.w,
                height: zone.h,
              },
            }));

          const workbookResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (workbookResult.isErr()) {
            const detail = new DesktopCommandExecutionError(workbookResult.error).message;
            return attemptedZonesResult({
              dashboardName,
              worksheetZones,
              validationWarnings,
              detail: `workbook XML was unavailable before viewpoint apply: ${detail}`,
            });
          }

          const updatedWorkbookXml = injectViewpoints(
            workbookResult.value,
            dashboardName,
            canonicalWorksheets,
          );
          const viewpointAccounting = accountDashboardViewpoints({
            beforeXml: workbookResult.value,
            afterXml: updatedWorkbookXml,
            dashboardName,
            requested: canonicalWorksheets,
          });
          if (viewpointAccounting.state === 'failed') {
            const failed = viewpointAccounting.failed.map((name) => `"${name}"`).join(', ');
            return attemptedZonesResult({
              dashboardName,
              worksheetZones,
              validationWarnings,
              detail: `viewpoint injection did not land for ${failed}`,
            });
          }

          if (viewpointAccounting.state === 'success-already-present') {
            await withApplyLock(() =>
              dispatchApplyFocus({
                focus: { navigate: 'artifact', sheetName: dashboardName },
                postedXml: workbookResult.value,
                executor,
                signal: extra.signal,
              }),
            );
          } else {
            const viewpointApplyResult = await loadWorkbookXml({
              xml: updatedWorkbookXml,
              focus: { navigate: 'artifact', sheetName: dashboardName },
              executor,
              signal: extra.signal,
            });
            if (viewpointApplyResult.isErr()) {
              const detail =
                viewpointApplyResult.error.type === 'execute-command-error'
                  ? new DesktopCommandExecutionError(viewpointApplyResult.error.error).message
                  : new WorkbookXmlLoadFailedError(viewpointApplyResult.error.error).message;
              return attemptedZonesResult({
                dashboardName,
                worksheetZones,
                validationWarnings,
                detail: `viewpoint workbook apply failed: ${detail}`,
              });
            }
            validationWarnings.push(...viewpointApplyResult.value.validationWarnings);
          }

          const readbackResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (readbackResult.isErr()) {
            const detail = new DesktopCommandExecutionError(readbackResult.error).message;
            return attemptedZonesResult({
              dashboardName,
              worksheetZones,
              validationWarnings,
              detail: `workbook XML readback was unavailable: ${detail}`,
            });
          }
          if (
            !readbackConfirmsDashboard(
              readbackResult.value,
              dashboardName,
              worksheetZones,
              canonicalWorksheets,
            )
          ) {
            return attemptedZonesResult({
              dashboardName,
              worksheetZones,
              validationWarnings,
              detail:
                'workbook XML readback did not confirm both the dashboard zone tree and all requested window viewpoints',
            });
          }

          return new Ok({
            dashboardName,
            zones: worksheetZones,
            verification: formatDashboardPromiseCheck(validationWarnings, true),
          });
        },
      });
    },
  });

  return tool;
};

function attemptedZonesResult({
  dashboardName,
  worksheetZones,
  validationWarnings,
  detail,
}: {
  dashboardName: string;
  worksheetZones: WorksheetZoneReceipt[];
  validationWarnings: Parameters<typeof formatDashboardPromiseCheck>[0];
  detail: string;
}): Ok<ComposeDashboardResult> {
  return new Ok({
    dashboardName,
    dashboardState: 'unknown',
    attemptedZones: worksheetZones,
    verification:
      formatDashboardPromiseCheck(validationWarnings).replace(
        'apply completed',
        'apply request returned without an error',
      ) +
      ` Dashboard "${dashboardName}" existence is UNKNOWN because post-apply readback did not confirm it; ` +
      `the attempted zone tree and requested window viewpoints are NOT confirmed (${detail}). ` +
      'Next call: list-dashboards to check whether it exists before deciding whether to retry.',
  });
}

function readbackConfirmsDashboard(
  workbookXml: string,
  dashboardName: string,
  expectedZones: WorksheetZoneReceipt[],
  requestedViewpoints: string[],
): boolean {
  const document = new DOMParser({ errorHandler: () => {} }).parseFromString(
    workbookXml.trim(),
    'text/xml',
  );
  if (document.getElementsByTagName('parsererror').length > 0) return false;

  const dashboard = findNamedElement(document.getElementsByTagName('dashboard'), dashboardName);
  if (!dashboard) return false;

  const actualZones: WorksheetZoneReceipt[] = [];
  const zonesElement = findDirectChildElement(dashboard, 'zones');
  const zoneElements = zonesElement?.getElementsByTagName('zone');
  for (let index = 0; index < (zoneElements?.length ?? 0); index++) {
    const zone = zoneElements?.item(index);
    const worksheet = zone?.getAttribute('name');
    if (!zone || worksheet == null) continue;
    const x = readCoordinate(zone, 'x');
    const y = readCoordinate(zone, 'y');
    const width = readCoordinate(zone, 'w');
    const height = readCoordinate(zone, 'h');
    if (x == null || y == null || width == null || height == null) continue;
    actualZones.push({
      worksheet,
      position: { x, y, width, height },
    });
  }

  if (!zonesMatchAsMultiset(actualZones, expectedZones)) return false;

  const dashboardWindow = findDashboardWindow(document, dashboardName);
  if (!dashboardWindow) return false;
  const actualViewpoints = directViewpointNames(dashboardWindow);
  return requestedViewpoints.every((requestedName) =>
    actualViewpoints.some((actualName) => xmlNamesEqual(actualName, requestedName)),
  );
}

function findDirectChildElement(parent: XmlElement, name: string): XmlElement | null {
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && child.nodeName === name) return child as XmlElement;
  }
  return null;
}

function findNamedElement(
  elements: ReturnType<XmlElement['getElementsByTagName']>,
  name: string,
): XmlElement | null {
  for (let index = 0; index < elements.length; index++) {
    const element = elements.item(index);
    if (element && xmlNamesEqual(element.getAttribute('name') ?? '', name)) return element;
  }
  return null;
}

function readCoordinate(zone: XmlElement, attribute: string): number | null {
  if (!zone.hasAttribute(attribute)) return null;
  const raw = zone.getAttribute(attribute);
  if (raw == null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function zonesMatchAsMultiset(
  actualZones: WorksheetZoneReceipt[],
  expectedZones: WorksheetZoneReceipt[],
): boolean {
  if (actualZones.length !== expectedZones.length) return false;
  const unmatched = [...actualZones];
  for (const expected of expectedZones) {
    const matchIndex = unmatched.findIndex(
      (actual) =>
        xmlNamesEqual(actual.worksheet, expected.worksheet) &&
        actual.position.x === expected.position.x &&
        actual.position.y === expected.position.y &&
        actual.position.width === expected.position.width &&
        actual.position.height === expected.position.height,
    );
    if (matchIndex === -1) return false;
    unmatched.splice(matchIndex, 1);
  }
  return unmatched.length === 0;
}

function findDashboardWindow(
  document: ReturnType<DOMParser['parseFromString']>,
  dashboardName: string,
): XmlElement | null {
  const windows = document.getElementsByTagName('window');
  for (let index = 0; index < windows.length; index++) {
    const window = windows.item(index);
    if (
      window &&
      window.getAttribute('class') === 'dashboard' &&
      xmlNamesEqual(window.getAttribute('name') ?? '', dashboardName)
    ) {
      return window;
    }
  }
  return null;
}

function directViewpointNames(dashboardWindow: XmlElement): string[] {
  const names: string[] = [];
  for (let index = 0; index < dashboardWindow.childNodes.length; index++) {
    const child = dashboardWindow.childNodes.item(index);
    if (!isElementNamed(child, 'viewpoints')) continue;
    for (let viewpointIndex = 0; viewpointIndex < child.childNodes.length; viewpointIndex++) {
      const viewpoint = child.childNodes.item(viewpointIndex);
      if (!isElementNamed(viewpoint, 'viewpoint')) continue;
      const name = viewpoint.getAttribute('name');
      if (name) names.push(name);
    }
  }
  return names;
}

function isElementNamed(node: XmlNode | null, tagName: string): node is XmlElement {
  return node?.nodeType === 1 && (node as XmlElement).tagName === tagName;
}
