import {
  Document as XmlDocument,
  DOMParser,
  Element as XmlElement,
  Node as XmlNode,
} from '@xmldom/xmldom';

import { normalizeXmlName, xmlNamesEqual } from '../xmlElement.js';

export type TargetDashboardInvariantIssueCode =
  | 'target-dashboard-missing'
  | 'target-dashboard-count'
  | 'worksheet-zone-missing'
  | 'worksheet-zone-unexpected'
  | 'worksheet-zone-duplicate'
  | 'worksheet-missing'
  | 'worksheet-window-missing'
  | 'dashboard-window-missing'
  | 'dashboard-window-count'
  | 'direct-viewpoints-container-count'
  | 'direct-viewpoints-order-invalid'
  | 'direct-viewpoint-missing'
  | 'direct-viewpoint-unexpected'
  | 'direct-viewpoint-duplicate';

export type TargetDashboardInvariantIssue = {
  code: TargetDashboardInvariantIssueCode;
  message: string;
};

export function targetDashboardInvariantIssues(
  workbookXml: string,
  dashboardName: string,
  expectedWorksheetNames?: string[],
): TargetDashboardInvariantIssue[] {
  const doc = new DOMParser({ errorHandler: () => {} }).parseFromString(
    workbookXml.trim() || '<empty/>',
    'text/xml',
  );
  const dashboards = directCollectionChildren(doc, 'dashboards', 'dashboard');
  const targetDashboards = dashboards.filter((dashboard) =>
    elementNameEquals(dashboard, dashboardName),
  );
  if (targetDashboards.length === 0) {
    return [
      {
        code: 'target-dashboard-missing',
        message: `Dashboard "${dashboardName}" was not present in workbook readback.`,
      },
    ];
  }

  const issues: TargetDashboardInvariantIssue[] = [];
  if (targetDashboards.length !== 1) {
    issues.push({
      code: 'target-dashboard-count',
      message:
        `Workbook readback must contain exactly one dashboard canonically named "${dashboardName}"; ` +
        `found ${targetDashboards.length}.`,
    });
  }

  const windows = directCollectionChildren(doc, 'windows', 'window');
  const dashboardWindows = windows.filter(
    (window) =>
      window.getAttribute('class') === 'dashboard' && elementNameEquals(window, dashboardName),
  );
  if (dashboardWindows.length === 0) {
    issues.push({
      code: 'dashboard-window-missing',
      message: `Dashboard "${dashboardName}" has no matching dashboard window.`,
    });
  } else if (dashboardWindows.length !== 1) {
    issues.push({
      code: 'dashboard-window-count',
      message:
        `Workbook readback must contain exactly one dashboard window canonically named "${dashboardName}"; ` +
        `found ${dashboardWindows.length}.`,
    });
  }
  if (targetDashboards.length !== 1 || dashboardWindows.length !== 1) return issues;

  const targetDashboard = targetDashboards[0];
  const dashboardWindow = dashboardWindows[0];
  const zoneNames = namedWorksheetZones(targetDashboard);
  const expectedNames = uniqueNames(expectedWorksheetNames ?? zoneNames);
  const worksheets = directCollectionChildren(doc, 'worksheets', 'worksheet');

  if (expectedWorksheetNames) {
    issues.push(
      ...exactNameClosureIssues('worksheet-zone', zoneNames, expectedNames, dashboardName),
    );
  }

  for (const worksheetName of expectedNames) {
    if (!zoneNames.some((zoneName) => xmlNamesEqual(zoneName, worksheetName))) {
      issues.push({
        code: 'worksheet-zone-missing',
        message: `Dashboard "${dashboardName}" has no worksheet zone for "${worksheetName}".`,
      });
    }
    if (!worksheets.some((worksheet) => elementNameEquals(worksheet, worksheetName))) {
      issues.push({
        code: 'worksheet-missing',
        message: `Worksheet "${worksheetName}" was not present in workbook readback.`,
      });
    }
    if (
      !windows.some(
        (window) =>
          window.getAttribute('class') === 'worksheet' && elementNameEquals(window, worksheetName),
      )
    ) {
      issues.push({
        code: 'worksheet-window-missing',
        message: `Worksheet "${worksheetName}" has no matching worksheet window.`,
      });
    }
  }

  const viewpointContainers = directChildren(dashboardWindow, 'viewpoints');
  if (viewpointContainers.length !== 1) {
    issues.push({
      code: 'direct-viewpoints-container-count',
      message:
        `Dashboard "${dashboardName}" must have exactly one direct viewpoints container; ` +
        `readback contained ${viewpointContainers.length}.`,
    });
  }
  if (viewpointContainers.length === 1 && !viewpointsAreFirstElement(dashboardWindow)) {
    issues.push({
      code: 'direct-viewpoints-order-invalid',
      message: `Dashboard "${dashboardName}" does not have viewpoints as its first direct element.`,
    });
  }
  const viewpointNames = viewpointContainers.flatMap((container) =>
    directChildren(container, 'viewpoint')
      .map((viewpoint) => viewpoint.getAttribute('name'))
      .filter((name): name is string => Boolean(name)),
  );
  if (expectedWorksheetNames) {
    issues.push(
      ...exactNameClosureIssues(
        'direct-viewpoint',
        viewpointNames,
        expectedNames,
        dashboardName,
        (viewpointName) =>
          worksheets.some((worksheet) => elementNameEquals(worksheet, viewpointName)) &&
          windows.some(
            (window) =>
              window.getAttribute('class') === 'worksheet' &&
              elementNameEquals(window, viewpointName),
          ),
      ),
    );
  }
  for (const worksheetName of expectedNames) {
    if (viewpointNames.some((viewpointName) => xmlNamesEqual(viewpointName, worksheetName))) {
      continue;
    }
    issues.push({
      code: 'direct-viewpoint-missing',
      message: `Dashboard "${dashboardName}" has no direct viewpoint for "${worksheetName}".`,
    });
  }

  return issues;
}

function directCollectionChildren(
  doc: XmlDocument,
  collectionName: string,
  childName: string,
): XmlElement[] {
  const collection = doc.getElementsByTagName(collectionName).item(0);
  return collection ? directChildren(collection, childName) : [];
}

function directChildren(parent: XmlNode, tagName: string): XmlElement[] {
  const children: XmlElement[] = [];
  for (let index = 0; index < parent.childNodes.length; index++) {
    const child = parent.childNodes.item(index);
    if (child?.nodeType === 1 && (child as unknown as XmlElement).tagName === tagName) {
      children.push(child as unknown as XmlElement);
    }
  }
  return children;
}

function viewpointsAreFirstElement(dashboardWindow: XmlElement): boolean {
  for (let index = 0; index < dashboardWindow.childNodes.length; index++) {
    const child = dashboardWindow.childNodes.item(index);
    if (child?.nodeType !== 1) continue;
    return (child as unknown as XmlElement).tagName === 'viewpoints';
  }
  return false;
}

function elementNameEquals(element: XmlElement, expectedName: string): boolean {
  const name = element.getAttribute('name');
  return Boolean(name && xmlNamesEqual(name, expectedName));
}

function namedWorksheetZones(dashboard: XmlElement): string[] {
  const names: string[] = [];
  const zones = dashboard.getElementsByTagName('zone');
  for (let index = 0; index < zones.length; index++) {
    const zone = zones.item(index);
    const name = zone?.getAttribute('name');
    const zoneType = zone?.getAttribute('type-v2');
    if (name && (!zoneType || zoneType === 'visual')) names.push(name);
  }
  return names;
}

function uniqueNames(names: string[]): string[] {
  return names.filter(
    (name, index) => names.findIndex((candidate) => xmlNamesEqual(candidate, name)) === index,
  );
}

function exactNameClosureIssues(
  kind: 'worksheet-zone' | 'direct-viewpoint',
  actualNames: string[],
  expectedNames: string[],
  dashboardName: string,
  allowUnexpected?: (name: string) => boolean,
): TargetDashboardInvariantIssue[] {
  const actualCounts = nameCounts(actualNames);
  const expectedKeys = new Set(expectedNames.map(normalizeXmlName));
  const issues: TargetDashboardInvariantIssue[] = [];

  for (const [key, { displayName, count }] of actualCounts) {
    if (!expectedKeys.has(key) && !allowUnexpected?.(displayName)) {
      issues.push({
        code: `${kind}-unexpected`,
        message: `Dashboard "${dashboardName}" has an unexpected ${kind.replaceAll('-', ' ')} for "${displayName}".`,
      });
    }
    if (count > 1) {
      issues.push({
        code: `${kind}-duplicate`,
        message:
          `Dashboard "${dashboardName}" has ${count} ${kind.replaceAll('-', ' ')} entries ` +
          `for "${displayName}"; exactly one is required.`,
      });
    }
  }

  return issues;
}

function nameCounts(names: string[]): Map<string, { displayName: string; count: number }> {
  const counts = new Map<string, { displayName: string; count: number }>();
  for (const name of names) {
    const key = normalizeXmlName(name);
    const existing = counts.get(key);
    counts.set(key, {
      displayName: existing?.displayName ?? name,
      count: (existing?.count ?? 0) + 1,
    });
  }
  return counts;
}
