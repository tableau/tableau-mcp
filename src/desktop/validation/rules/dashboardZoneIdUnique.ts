import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';
import { canonicalDigits, enclosingDeviceLayout, nextFreeId } from './dashboardZoneContext.js';
import { parseXml } from './parseXml.js';

const DASHBOARD_XPATH = '//dashboard';
const ZONE_XPATH = '//dashboard//zone[@id]';

function label(zone: Element): string {
  const name = zone.getAttribute('name') || zone.getAttribute('type-v2');
  return name ? `"${name}"` : 'a zone with no name';
}

export const dashboardZoneIdUniqueRule: ValidationRule = {
  id: 'dashboard-zone-id-unique',
  description:
    'Rejects a dashboard zone id that another zone in the same layout already uses; Desktop keeps one zone per id and silently drops the other.',
  contexts: ['dashboard', 'workbook'],

  validate(xml: string): ValidationIssue[] {
    const doc = parseXml(xml);
    if (!doc) return [];

    const issues: ValidationIssue[] = [];
    for (const dashboard of xpath.select(DASHBOARD_XPATH, doc as unknown as Node) as Element[]) {
      // Storyboards are not probed, so they are skipped.
      if (dashboard.getAttribute('type') === 'storyboard') continue;
      const dashboardName = dashboard.getAttribute('name') || '(unnamed)';
      const groups = new Map<Element | undefined, Map<string, Element[]>>();

      for (const zone of xpath.select('.//zone[@id]', dashboard as unknown as Node) as Element[]) {
        const canonical = canonicalDigits(zone.getAttribute('id')!);
        if (canonical === undefined) continue;
        const scope = enclosingDeviceLayout(zone);
        let byId = groups.get(scope);
        if (!byId) groups.set(scope, (byId = new Map()));
        const zones = byId.get(canonical);
        if (zones) zones.push(zone);
        else byId.set(canonical, [zone]);
      }

      let nextId = nextFreeId(dashboard);
      for (const [scope, byId] of groups) {
        for (const [canonical, zones] of byId) {
          if (zones.length < 2) continue;
          const deviceLayout = scope && (scope.getAttribute('name') || '(unnamed)');
          const freeIds = zones.slice(1).map(() => `id="${nextId++}"`);
          issues.push({
            ruleId: 'dashboard-zone-id-unique',
            severity: 'error',
            message:
              `Dashboard "${dashboardName}"${deviceLayout === undefined ? '' : ` (device layout "${deviceLayout}")`} ` +
              `has ${zones.length} zones with id="${canonical}": ${zones
                .map(label)
                .sort((x, y) => x.localeCompare(y))
                .join(', ')}. ` +
              'Desktop keeps only one zone per id and drops the others without an error.',
            xpath: ZONE_XPATH,
            suggestion: `Keep id="${canonical}" on the zone Desktop already shows, and give each other zone an unused id, such as ${freeIds.join(', ')}.`,
          });
        }
      }
    }
    return issues;
  },
};
