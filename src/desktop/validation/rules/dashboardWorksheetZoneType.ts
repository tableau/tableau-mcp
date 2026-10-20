import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';
import { parseXml } from './parseXml.js';

const WORKSHEET_ZONE_TYPE = '//dashboard//zone[@type-v2="worksheet"]';

export const dashboardWorksheetZoneTypeRule: ValidationRule = {
  id: 'dashboard-worksheet-zone-type',
  description:
    'Rejects type-v2="worksheet" dashboard zones, which can load without a visual doc and crash when removed.',
  contexts: ['dashboard', 'workbook'],

  validate(xml: string): ValidationIssue[] {
    const doc = parseXml(xml);
    if (!doc) return [];

    // The agent added this type after a missing-visual-doc rejection.
    // Worksheet zones use their name with no type-v2 attribute. The invented
    // "worksheet" type loaded without a visual document and later hit
    // VisualDocEditorImpl::PendingDeleteEditFactory::Create on zone removal.
    const zones = xpath.select(WORKSHEET_ZONE_TYPE, doc as unknown as Node) as Element[];
    return zones.map((zone) => ({
      ruleId: 'dashboard-worksheet-zone-type',
      severity: 'error',
      message:
        `Dashboard zone "${zone.getAttribute('name') || '(unnamed)'}" ` +
        'uses unsupported type-v2="worksheet". It can load without a visual representation ' +
        'and crash Tableau when removed. Remove this attribute from the worksheet zone.',
      xpath: WORKSHEET_ZONE_TYPE,
      suggestion:
        'Remove type-v2="worksheet" and keep name="Worksheet Name" on the zone. ' +
        'If Tableau reports a missing visual representation, inspect worksheet view registration ' +
        'in the dashboard window, not marks or fields: blank worksheets are valid. ' +
        'Desktop API 0.2.22 and newer registers submitted worksheet zones through dashboard apply; ' +
        'on older or unknown versions, add the worksheets to the dashboard in Desktop and re-read ' +
        'before retrying. Changing the zone type does not fix a missing visual doc.',
    }));
  },
};
