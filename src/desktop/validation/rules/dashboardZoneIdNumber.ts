import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';
import {
  enclosingDashboard,
  enclosingDeviceLayout,
  enclosingDeviceLayoutName,
} from './dashboardZoneContext.js';
import { parseXml } from './parseXml.js';

const ZONE_XPATH = '//dashboard//zone[@id]';
const CANONICAL_ID = /^(0|[1-9][0-9]*)$/;

function canonicalDigits(id: string): string | undefined {
  const trimmed = id.trim();
  const digits = trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;
  return /^[0-9]+$/.test(digits) ? digits.replace(/^0+(?=[0-9])/, '') : undefined;
}

// Device layouts may reuse main-layout ids, so a collision only counts within one layout scope.
function takenByAnotherZone(zone: Element, dashboard: Element | undefined, value: string): boolean {
  if (!dashboard) return false;
  const scope = enclosingDeviceLayout(zone);
  return (xpath.select('.//zone[@id]', dashboard as unknown as Node) as Element[]).some(
    (other) =>
      other !== zone &&
      enclosingDeviceLayout(other) === scope &&
      canonicalDigits(other.getAttribute('id')!) === value,
  );
}

function nextFreeId(dashboard: Element | undefined): number {
  if (!dashboard) return 1;
  let max = 0;
  for (const zone of xpath.select('.//zone[@id]', dashboard as unknown as Node) as Element[]) {
    const id = zone.getAttribute('id')!;
    if (CANONICAL_ID.test(id)) max = Math.max(max, Number(id));
  }
  return max + 1;
}

export const dashboardZoneIdNumberRule: ValidationRule = {
  id: 'dashboard-zone-id-number',
  description:
    'Rejects dashboard zone ids that are not plain whole numbers; Desktop reads "05" as 5, so a swap written with them escapes the zone-swap check and crashes it.',
  contexts: ['dashboard', 'workbook'],

  validate(xml: string): ValidationIssue[] {
    const doc = parseXml(xml);
    if (!doc) return [];

    const issues: ValidationIssue[] = [];
    for (const zone of xpath.select(ZONE_XPATH, doc as unknown as Node) as Element[]) {
      const id = zone.getAttribute('id')!;
      if (CANONICAL_ID.test(id)) continue;

      const dashboard = enclosingDashboard(zone);
      const dashboardName = dashboard?.getAttribute('name') || '(unnamed)';
      const deviceLayout = enclosingDeviceLayoutName(zone);
      const label = zone.getAttribute('name') || zone.getAttribute('type-v2');
      const canonical = canonicalDigits(id);
      const suggestion =
        canonical !== undefined && !takenByAnotherZone(zone, dashboard, canonical)
          ? `Write it as id="${canonical}".`
          : `Use a whole number such as id="${nextFreeId(dashboard)}" that no other zone on this dashboard uses.`;
      issues.push({
        ruleId: 'dashboard-zone-id-number',
        severity: 'error',
        message:
          `Dashboard "${dashboardName}"${deviceLayout === undefined ? '' : ` (device layout "${deviceLayout}")`} ` +
          `zone id="${id}"${label ? ` (${label})` : ''} is not a plain whole number. ` +
          'Desktop treats id="05" as zone 5, but this server compares zone ids as written, so its checks cannot match them.',
        xpath: ZONE_XPATH,
        suggestion,
      });
    }
    return issues;
  },
};
