import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';

const NON_WORKSHEET_ZONE_TYPES = new Set([
  'layout-basic',
  'layout-flow',
  'text',
  'filter',
  'empty',
  'bitmap',
  'web',
  'parameter',
  'legend',
]);

export const dashboardZoneWorksheetReferencesRule: ValidationRule = {
  id: 'dashboard-zone-worksheet-references',
  description: 'Dashboard worksheet zones must reference existing worksheets by name.',
  contexts: ['workbook'],

  validate(xml: string): ValidationIssue[] {
    const doc = parseXml(xml);
    if (!doc?.documentElement) return [];

    const worksheetNodes = xpath.select(
      '//worksheets/worksheet[@name]',
      doc as unknown as Node,
    ) as Element[];
    const worksheetNames = new Set(
      worksheetNodes.map((ws) => ws.getAttribute('name')).filter(Boolean),
    );
    if (worksheetNames.size === 0) return [];

    const zones = xpath.select(
      '//dashboards/dashboard//zone[@name]',
      doc as unknown as Node,
    ) as Element[];
    const issues: ValidationIssue[] = [];

    for (const zone of zones) {
      if (!isWorksheetZone(zone)) continue;

      const zoneName = zone.getAttribute('name');
      if (!zoneName || worksheetNames.has(zoneName)) continue;

      const dashboards = xpath.select(
        'ancestor::dashboard[1]',
        zone as unknown as Node,
      ) as Element[];
      const dashboardName = dashboards[0]?.getAttribute('name') ?? '(unknown dashboard)';
      issues.push({
        ruleId: 'dashboard-zone-worksheet-references',
        severity: 'error',
        message:
          `Dashboard '${dashboardName}' has a worksheet zone referencing '${zoneName}', ` +
          'but no worksheet with that name exists.',
        xpath: `//dashboard[@name="${dashboardName}"]//zone[@name="${zoneName}"]`,
        suggestion: `Create or rename a worksheet to '${zoneName}', or update the dashboard zone to reference an existing worksheet.`,
      });
    }

    return issues;
  },
};

function isWorksheetZone(zone: Element): boolean {
  const name = zone.getAttribute('name');
  if (!name) return false;

  const typeV2 = zone.getAttribute('type-v2');
  if (typeV2 && NON_WORKSHEET_ZONE_TYPES.has(typeV2)) return false;

  if (zone.hasAttribute('param') && (typeV2 === 'filter' || zone.hasAttribute('values'))) {
    return false;
  }

  return true;
}

function parseXml(xml: string): Document | null {
  try {
    return new DOMParser({ errorHandler: () => {} }).parseFromString(
      String(xml ?? '').trim() || '<empty/>',
      'text/xml',
    ) as unknown as Document;
  } catch {
    return null;
  }
}
