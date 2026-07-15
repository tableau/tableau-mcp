import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';
import { parseXml } from './parseXml.js';

const MAX_CATEGORICAL_FILTERS = 5;

export const categoricalFilterProliferationRule: ValidationRule = {
  id: 'categorical-filter-proliferation',
  description:
    'Flags more than 5 categorical filter controls in a proposal (performance/usability). ' +
    'Flag-gated via ENABLE_FILTER_GUARDRAIL; inert and non-blocking by default.',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    if (!process.env.ENABLE_FILTER_GUARDRAIL) return [];

    const doc = parseXml(xml);
    if (!doc) return [];

    const categorical = xpath.select(
      "//filter[@class='categorical']",
      doc as unknown as Node,
    ) as Element[];
    const count = categorical.length;
    if (count <= MAX_CATEGORICAL_FILTERS) return [];

    return [
      {
        ruleId: 'categorical-filter-proliferation',
        severity: 'error',
        message:
          `BLOCKED, not applied: this proposal adds ${count} categorical filter controls. ` +
          'This can hurt dashboard performance and usability. ' +
          'Re-apply with only 3-5 high-value filter controls. If you cannot determine which 3-5 are most useful, ' +
          'present a scoped recommendation and ask the user to confirm before applying. ' +
          'Do not apply the oversized filter set. Relevant guidance: ' +
          'expertise://tableau/tactics/data/dashboard-performance-efficient-workbooks.',
        xpath: "//filter[@class='categorical']",
        suggestion:
          'Keep 3-5 high-value categorical filters; replace the rest with a parameter, a filter action, or a drill path.',
      },
    ];
  },
};
