import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';

import { xmlNamesEqual } from '../../xmlElement.js';
import type { ValidationIssue, ValidationRule } from '../types.js';

export const dashboardZonesHaveViewpointsRule: ValidationRule = {
  id: 'dashboard-zones-have-viewpoints',
  description:
    'Rejects live dashboard windows that omit viewpoints for worksheets used by dashboard zones.',
  contexts: ['workbook'],

  validate(xml: string): ValidationIssue[] {
    let doc: Document;
    try {
      doc = new DOMParser({ errorHandler: () => {} }).parseFromString(
        xml.trim() || '<empty/>',
        'text/xml',
      ) as unknown as Document;
    } catch {
      return [];
    }

    const dashboards = xpath.select(
      '//dashboards/dashboard[@name]',
      doc as unknown as Node,
    ) as Element[];
    const windows = xpath.select(
      '//windows/window[@class="dashboard"][@name]',
      doc as unknown as Node,
    ) as Element[];
    const workbookWorksheetNames = (
      xpath.select('//worksheets/worksheet[@name]', doc as unknown as Node) as Element[]
    )
      .map((worksheet) => worksheet.getAttribute('name'))
      .filter((name): name is string => Boolean(name));
    const issues: ValidationIssue[] = [];

    for (const dashboard of dashboards) {
      const dashboardName = dashboard.getAttribute('name');
      if (!dashboardName) continue;
      const window = windows.find((candidate) => {
        const windowName = candidate.getAttribute('name');
        return Boolean(windowName && xmlNamesEqual(windowName, dashboardName));
      });
      if (!window) continue;

      const viewpointNames = (
        xpath.select('./viewpoints/viewpoint[@name]', window as unknown as Node) as Element[]
      )
        .map((viewpoint) => viewpoint.getAttribute('name'))
        .filter((name): name is string => Boolean(name));
      const worksheetNames = (
        xpath.select('.//zone[@name]', dashboard as unknown as Node) as Element[]
      )
        .filter((zone) => {
          const zoneName = zone.getAttribute('name');
          const zoneType = zone.getAttribute('type-v2');
          return (
            Boolean(zoneName) &&
            (!zoneType || zoneType === 'visual') &&
            workbookWorksheetNames.some((name) => xmlNamesEqual(name, zoneName!))
          );
        })
        .map((zone) => zone.getAttribute('name'))
        .filter((name): name is string => Boolean(name))
        .filter(
          (name, index, names) =>
            names.findIndex((candidate) => xmlNamesEqual(candidate, name)) === index,
        );

      for (const worksheetName of worksheetNames) {
        if (viewpointNames.some((name) => xmlNamesEqual(name, worksheetName))) continue;
        issues.push({
          ruleId: 'dashboard-zones-have-viewpoints',
          severity: 'error',
          message:
            `Dashboard "${dashboardName}" uses worksheet "${worksheetName}" in a zone, but its ` +
            'dashboard window has no direct matching viewpoint. Include the viewpoint in the same ' +
            'whole-workbook apply.',
          xpath: `//window[@class="dashboard"][@name=${JSON.stringify(dashboardName)}]/viewpoints`,
          suggestion: `Add <viewpoint name="${worksheetName}"> to the dashboard window.`,
        });
      }
    }

    return issues;
  },
};
