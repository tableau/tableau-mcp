import {
  Document as XmlDocument,
  DOMParser,
  Element as XmlElement,
  XMLSerializer,
} from '@xmldom/xmldom';

import { dashboardZonesHaveViewpointsRule } from '../../validation/rules/dashboardZonesHaveViewpoints.js';
import { dashboardZonesReferenceIncludedWorksheetsRule } from '../../validation/rules/dashboardZonesReferenceIncludedWorksheets.js';
import { worksheetMissingWindowRule } from '../../validation/rules/worksheetMissingWindow.js';
import type { ValidationIssue } from '../../validation/types.js';
import { xmlNamesEqual } from '../../xmlElement.js';

const targetDashboardRules = [
  dashboardZonesReferenceIncludedWorksheetsRule,
  worksheetMissingWindowRule,
  dashboardZonesHaveViewpointsRule,
];

export function candidateIntroducedBlockingIssues(
  baselineIssues: ValidationIssue[],
  candidateIssues: ValidationIssue[],
): ValidationIssue[] {
  const baselineCounts = new Map<string, number>();
  for (const issue of baselineIssues) {
    if (issue.severity !== 'error') continue;
    const signature = validationIssueSignature(issue);
    baselineCounts.set(signature, (baselineCounts.get(signature) ?? 0) + 1);
  }

  const introduced: ValidationIssue[] = [];
  for (const issue of candidateIssues) {
    if (issue.severity !== 'error') continue;
    const signature = validationIssueSignature(issue);
    const remaining = baselineCounts.get(signature) ?? 0;
    if (remaining > 0) {
      baselineCounts.set(signature, remaining - 1);
    } else {
      introduced.push(issue);
    }
  }
  return introduced;
}

export function targetDashboardInvariantIssues(
  workbookXml: string,
  dashboardName: string,
): ValidationIssue[] {
  const doc = new DOMParser({ errorHandler: () => {} }).parseFromString(
    workbookXml.trim() || '<empty/>',
    'text/xml',
  );
  const dashboards = directCollectionChildren(doc, 'dashboards', 'dashboard');
  const targetDashboard = dashboards.find((dashboard) => {
    const name = dashboard.getAttribute('name');
    return Boolean(name && xmlNamesEqual(name, dashboardName));
  });
  if (!targetDashboard) return [];

  const worksheetNames = directDescendantZoneNames(targetDashboard);
  const worksheets = directCollectionChildren(doc, 'worksheets', 'worksheet').filter(
    (worksheet) => {
      const name = worksheet.getAttribute('name');
      return Boolean(name && worksheetNames.some((candidate) => xmlNamesEqual(candidate, name)));
    },
  );
  const windows = directCollectionChildren(doc, 'windows', 'window').filter((window) => {
    const name = window.getAttribute('name');
    if (!name) return false;
    if (window.getAttribute('class') === 'dashboard') {
      return xmlNamesEqual(name, dashboardName);
    }
    const windowClass = window.getAttribute('class');
    return (
      (!windowClass || windowClass === 'worksheet') &&
      worksheetNames.some((candidate) => xmlNamesEqual(candidate, name))
    );
  });

  const serializer = new XMLSerializer();
  const scopedWorkbook =
    '<workbook><worksheets>' +
    worksheets.map((worksheet) => serializer.serializeToString(worksheet)).join('') +
    '</worksheets><dashboards>' +
    serializer.serializeToString(targetDashboard) +
    '</dashboards><windows>' +
    windows.map((window) => serializer.serializeToString(window)).join('') +
    '</windows></workbook>';

  return targetDashboardRules
    .flatMap((rule) => rule.validate(scopedWorkbook))
    .filter((issue) => issue.severity === 'error');
}

export function validationIssueSignature(issue: ValidationIssue): string {
  return JSON.stringify({
    ruleId: issue.ruleId,
    message: issue.message,
    xpath: issue.xpath ?? null,
    suggestion: issue.suggestion ?? null,
    severity: issue.severity,
  });
}

function directCollectionChildren(
  doc: XmlDocument,
  collectionName: string,
  childName: string,
): XmlElement[] {
  const collection = doc.getElementsByTagName(collectionName).item(0);
  if (!collection) return [];
  const children: XmlElement[] = [];
  for (let index = 0; index < collection.childNodes.length; index++) {
    const child = collection.childNodes.item(index);
    const element = child as unknown as XmlElement | null;
    if (element?.nodeType === 1 && element.tagName === childName) {
      children.push(element);
    }
  }
  return children;
}

function directDescendantZoneNames(dashboard: XmlElement): string[] {
  const names: string[] = [];
  const zones = dashboard.getElementsByTagName('zone');
  for (let index = 0; index < zones.length; index++) {
    const zone = zones.item(index);
    const name = zone?.getAttribute('name');
    const zoneType = zone?.getAttribute('type-v2');
    if (
      name &&
      (!zoneType || zoneType === 'visual') &&
      !names.some((candidate) => xmlNamesEqual(candidate, name))
    ) {
      names.push(name);
    }
  }
  return names;
}
