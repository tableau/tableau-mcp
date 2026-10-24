import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';
import { enclosingDashboard, enclosingDeviceLayoutName } from './dashboardZoneContext.js';
import { parseXml } from './parseXml.js';

const CARD_ZONE_XPATH =
  '//dashboard//zone[@type-v2="filter" or @type-v2="color" or @type-v2="size" or @type-v2="shape" or @type-v2="highlighter"]';

function isBlank(value: string | null): boolean {
  return value === null || value.trim() === '';
}

function worksheetZoneNames(dashboard: Element): string[] {
  const names = new Set<string>();
  const zones = xpath.select('.//zone', dashboard as unknown as Node) as Element[];
  for (const zone of zones) {
    const name = zone.getAttribute('name');
    if (!isBlank(name) && !zone.hasAttribute('type-v2')) names.add(name!.trim());
  }
  return [...names];
}

export const dashboardCardZoneNameRule: ValidationRule = {
  id: 'dashboard-card-zone-name',
  description:
    'Rejects filter, legend and highlighter dashboard zones with no worksheet name, which can crash Tableau Desktop.',
  contexts: ['dashboard', 'workbook'],

  validate(xml: string): ValidationIssue[] {
    const doc = parseXml(xml);
    if (!doc) return [];

    const zones = xpath.select(CARD_ZONE_XPATH, doc as unknown as Node) as Element[];
    const issues: ValidationIssue[] = [];
    for (const zone of zones) {
      if (!isBlank(zone.getAttribute('name'))) continue;

      const dashboard = enclosingDashboard(zone);
      const dashboardName = dashboard?.getAttribute('name') || '(unnamed)';
      const param = zone.getAttribute('param');
      const deviceLayout = enclosingDeviceLayoutName(zone);
      const sheets = dashboard ? worksheetZoneNames(dashboard) : [];
      issues.push({
        ruleId: 'dashboard-card-zone-name',
        severity: 'error',
        message:
          `Dashboard "${dashboardName}" zone id="${zone.getAttribute('id') ?? '(none)'}"` +
          `${deviceLayout === undefined ? '' : ` (device layout "${deviceLayout}")`} ` +
          `type-v2="${zone.getAttribute('type-v2')}"${param ? ` param="${param}"` : ''} has no name. ` +
          'Tableau Desktop can crash on a filter, legend or highlighter zone without the worksheet it ' +
          'belongs to (and otherwise draws nothing).',
        xpath: CARD_ZONE_XPATH,
        suggestion:
          'Add name="<worksheet>" for the worksheet whose filter, legend or highlighter this zone shows. ' +
          (sheets.length > 0
            ? `Worksheet zones on this dashboard: ${sheets.map((n) => `"${n}"`).join(', ')}.`
            : 'This dashboard has no worksheet zones yet; add the worksheet zone first, then name this zone after it.'),
      });
    }
    return issues;
  },
};
