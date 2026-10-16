import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';

export const actionNestedInDashboardRule: ValidationRule = {
  id: 'action-nested-in-dashboard',
  description:
    'Errors when a dashboard/parameter action (<actions>/<edit-parameter-action>/<change-parameter>) is nested INSIDE a ' +
    '<dashboard> element. Actions must be a TOP-LEVEL <actions> element in the workbook (sibling to <worksheets>/' +
    "<dashboards>), not a dashboard child — a dashboard-nested action fails the workbook load ('Errors occurred while " +
    "trying to load the workbook'). Move the <actions> block out of the <dashboard> to the workbook root.",
  contexts: ['workbook', 'dashboard'],

  validate(xml: string): ValidationIssue[] {
    const s = String(xml ?? '');
    if (!/<(actions|action|edit-parameter-action|change-parameter)\b/i.test(s)) return [];

    const doc = parseXml(s);
    if (!doc?.documentElement) return [];

    const nested = xpath.select(
      '//dashboard//actions | //dashboard//edit-parameter-action | //dashboard//change-parameter | //dashboard//action',
      doc as unknown as Node,
    ) as Element[];
    if (nested.length === 0) return [];

    const actionCount = (
      xpath.select(
        '//dashboard//edit-parameter-action | //dashboard//change-parameter | //dashboard//action',
        doc as unknown as Node,
      ) as Element[]
    ).length;

    return [
      {
        ruleId: 'action-nested-in-dashboard',
        severity: 'error',
        message:
          `A dashboard/parameter action is nested INSIDE a <dashboard> element (${actionCount || nested.length} action node(s) ` +
          'under <dashboard>). Tableau rejects the workbook load for this — "Errors occurred while trying to load the ' +
          'workbook" — even when the action\'s target/source are correct. Actions are NOT dashboard children.',
        xpath: '//dashboard//actions',
        suggestion:
          'Move the <actions> block OUT of the <dashboard> element to the WORKBOOK ROOT, as a direct child sibling of ' +
          "<worksheets> and <dashboards> (a single top-level <actions>…</actions>). The action's shape (activation, " +
          'source worksheet, target-parameter) can stay identical — only its LOCATION is wrong. ' +
          'See expertise://tableau/tactics/dashboard/zones ("Actions live in a top-level <actions> element … NOT inside ' +
          'the dashboard element itself").',
      },
    ];
  },
};

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
