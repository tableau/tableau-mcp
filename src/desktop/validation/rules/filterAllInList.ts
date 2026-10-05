import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';
import { parseXml } from './parseXml.js';

const HAS_ALL_ENUMERATION = ".//groupfilter[@*[local-name()='ui-enumeration']='all']";
const HAS_MEMBER_ENUMERATION = ".//groupfilter[@function='member']";

export const filterAllInListRule: ValidationRule = {
  id: 'filter-all-in-list',
  description:
    "Errors when a categorical filter is an enumerated 'All in list' snapshot (ui-enumeration='all' over a frozen " +
    "list of members) instead of a dynamic '(All)' level-members filter. 'All in list' silently excludes new data.",
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const doc = parseXml(xml);
    if (!doc) return [];

    const offenders = xpath.select(
      `//filter[@class='categorical'][${HAS_ALL_ENUMERATION}][${HAS_MEMBER_ENUMERATION}]`,
      doc as unknown as Node,
    ) as Element[];

    const issues: ValidationIssue[] = [];
    for (const filter of offenders) {
      const column = filter.getAttribute('column') ?? '(unknown field)';
      issues.push({
        ruleId: 'filter-all-in-list',
        severity: 'error',
        message:
          `Categorical filter on "${column}" is an "All in list" enumeration — a static snapshot of the ` +
          'dimension members that exist right now. When new values enter the data they are silently excluded, ' +
          'so the filter (and any viz it scopes) quietly drops the new rows with no error. ' +
          'Use dynamic "(All)" instead so new members are always included.',
        xpath: "//filter[@class='categorical']",
        suggestion:
          'Replace the enumerated member list with the dynamic level-members form: a single ' +
          '<groupfilter function="level-members" level="[none:Field:nk]" user:ui-enumeration="all" user:ui-marker="enumerate"/> ' +
          '(no per-member <groupfilter function="member"> children). This is the "Use all" / dynamic "(All)" filter that survives new data.',
      });
    }
    return issues;
  },
};
