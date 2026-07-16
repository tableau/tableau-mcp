/**
 * Validation rule: malformed-top-n-filter
 *
 * W-23447507: a Top-N filter authored as a flat <groupfilter function="filter">
 * with count/direction attributes is silently stripped by Tableau on apply. The
 * confirmed working form is the nested function="end" -> order -> level-members
 * recipe, plus a matching <slices> entry.
 *
 * Ported from agent-to-tableau-desktop.
 */
import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';
import { parseXml } from './parseXml.js';

const TOP_N_FILTER_XPATH =
  "//filter[not(ancestor::group) and groupfilter[@function='filter' and " +
  '(@count or @count-type or @field) and ' +
  "(translate(@direction, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')='top' or " +
  "translate(@direction, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')='bottom')]]";

export const malformedTopNFilterRule: ValidationRule = {
  id: 'malformed-top-n-filter',
  description:
    "Errors when a Top-N filter uses the flat <groupfilter function='filter'> shape that Tableau silently strips. " +
    "Use the nested function='end' recipe instead.",
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const doc = parseXml(xml);
    if (!doc) return [];

    const filters = xpath.select(TOP_N_FILTER_XPATH, doc as unknown as Node) as Element[];

    return filters.map((filter): ValidationIssue => {
      const column = filter.getAttribute('column') ?? '(unknown column)';
      return {
        ruleId: 'malformed-top-n-filter',
        severity: 'error',
        message:
          `Top-N filter on "${column}" uses the flat <groupfilter function="filter"> shape. ` +
          'Tableau silently strips this filter on apply, so the viz shows unfiltered data while apply reports success.',
        xpath:
          "//filter[not(ancestor::group)]/groupfilter[@function='filter'][@direction='top' or @direction='bottom']",
        suggestion:
          'Author Top-N with the confirmed nested recipe: ' +
          '<groupfilter function="end" end="top" count="N"> wrapping ' +
          '<groupfilter function="order" direction="DESC" expression="SUM([Measure])"> wrapping ' +
          '<groupfilter function="level-members" level="[none:Field:nk]"/>, plus a matching <slices><column> entry.',
      };
    });
  },
};
