import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';

import type { ValidationContext, ValidationIssue, ValidationRule } from '../types.js';

export const setCountMalformedParameterRule = {
  id: 'set-count-malformed-parameter',
  description:
    "Errors when a set's <groupfilter count='[Parameters].[X]'> references a parameter X that isn't a well-formed " +
    'parameter (no param-domain-type / no value / no <calculation>). The set applies but fails to compute at query ' +
    "time — 'The filter limit expression is invalid' (0x8790065E). Declare the count parameter as a real range " +
    'parameter (param-domain-type + value + <calculation>) before the set references it.',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string, context?: ValidationContext): ValidationIssue[] {
    const s = String(xml ?? '');
    const doc = parseXml(s);
    if (!doc?.documentElement) return [];

    const countRefs = new Set<string>();
    for (const match of s.matchAll(
      /<groupfilter\b[^>]*\bcount=(['"])\[Parameters\]\.\[([^\]]+)\]\1/gi,
    )) {
      countRefs.add(match[2]);
    }
    if (countRefs.size === 0) return [];

    const isWorksheet = context === 'worksheet';
    const fragmentDeclaresParams =
      (xpath.select("count(//datasource[@name='Parameters'])", doc as unknown as Node) as number) >
      0;
    const suppressUndeclared = isWorksheet && !fragmentDeclaresParams;

    const wellFormedParams = (
      xpath.select('//column[@param-domain-type]', doc as unknown as Node) as Element[]
    )
      .filter((col) => colIsWellFormed(col) && col.getAttribute('datatype') === 'integer')
      .map((col) => col.getAttribute('name') ?? '')
      .filter(Boolean);

    const issues: ValidationIssue[] = [];
    for (const paramName of countRefs) {
      const cols = xpath.select(
        `//column[@name="[${paramName}]"]`,
        doc as unknown as Node,
      ) as Element[];
      if (cols.length === 0) {
        if (suppressUndeclared) continue;
        issues.push(malformedIssue(paramName, 'not declared anywhere', wellFormedParams));
        continue;
      }

      if (!cols.some(colIsWellFormed)) {
        issues.push(
          malformedIssue(
            paramName,
            'declared as a bare <column> (no param-domain-type / no value / no <calculation>)',
            wellFormedParams,
          ),
        );
      }
    }

    return issues;
  },
} satisfies ValidationRule;

function colIsWellFormed(col: Element): boolean {
  const hasDomain = col.getAttribute('param-domain-type') !== null;
  const hasValue = col.getAttribute('value') !== null && col.getAttribute('value') !== '';
  const hasCalc = (xpath.select('count(.//calculation)', col as unknown as Node) as number) > 0;
  return hasDomain && (hasValue || hasCalc);
}

function malformedIssue(
  paramName: string,
  why: string,
  wellFormedParams: string[] = [],
): ValidationIssue {
  const others = wellFormedParams.filter((name) => name !== `[${paramName}]`);
  const repointHint =
    others.length > 0
      ? `You ALREADY have well-formed parameter(s): ${others.join(', ')}. Most likely fix: point the ` +
        `count at one of THOSE — change count='[Parameters].[${paramName}]' to ` +
        `count='[Parameters].${others[0]}'. Do NOT invent a new parameter name; reuse the one you declared. ` +
        'Alternatively, '
      : '';
  const suggestion =
    `${repointHint}${others.length > 0 ? 'make' : 'Declare'} [${paramName}] a REAL range parameter BEFORE the set references it: ` +
    `<column caption='…' datatype='integer' name='[${paramName}]' param-domain-type='range' role='measure' ` +
    "type='quantitative' value='5'><calculation class='tableau' formula='5'/><range .../></column>. " +
    "A bare <column> (no param-domain-type/value/calculation) is a field stub, not a parameter — the set's " +
    "filter-limit can't resolve it. The count param name must EXACTLY match a declared well-formed parameter.";

  return {
    ruleId: 'set-count-malformed-parameter',
    severity: 'error',
    message:
      `A set's <groupfilter count='[Parameters].[${paramName}]'> references a parameter that is ${why}. ` +
      'The set applies but CANNOT compute at query time — Tableau throws "The filter limit expression is invalid" ' +
      '(0x8790065E). The count XML looks fine, so this is invisible until the viz renders.',
    xpath: `//groupfilter[contains(@count,'${paramName}')]`,
    suggestion,
  };
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
