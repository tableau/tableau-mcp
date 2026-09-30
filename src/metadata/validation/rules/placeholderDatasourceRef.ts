import type { ValidationIssue, ValidationRule } from '../types.js';

const PLACEHOLDER_DS = /\[(DS|DATASOURCE|DATA ?SOURCE|YOUR ?DATASOURCE|MY ?DATASOURCE)\]\.\[/gi;

export const placeholderDatasourceRefRule: ValidationRule = {
  id: 'placeholder-datasource-ref',
  description:
    'Errors when a column reference uses a PLACEHOLDER datasource name (e.g. [DS].[…], [Datasource].[…]) instead ' +
    'of the real datasource. The XML applies but the reference resolves to nothing and is silently ignored (a sort ' +
    "that doesn't sort, a filter that doesn't filter). Substitute the real datasource name.",
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const s = String(xml ?? '');
    const issues: ValidationIssue[] = [];
    const seen = new Set<string>();

    for (const match of s.matchAll(PLACEHOLDER_DS)) {
      const token = match[1];
      const key = `[${token}]`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      issues.push({
        ruleId: 'placeholder-datasource-ref',
        severity: 'error',
        message:
          `A column reference uses a PLACEHOLDER datasource name "[${token}]" (as in "[${token}].[…]") instead of the ` +
          `real datasource. The XML is well-formed and will "apply", but "[${token}]" resolves to no datasource, so the ` +
          "reference is SILENTLY IGNORED — a sort won't sort, a filter won't filter, an encoding won't bind.",
        xpath: "//*[contains(.,'[DS].[')] | //@*[contains(.,'[DS].[')]",
        suggestion:
          'Replace the placeholder with the REAL datasource name (e.g. [Sample - Superstore], or the federated id from ' +
          'tableau-list-available-fields / lookup-workbook-schema). Build every column ref from a real field instance — ' +
          `[<real datasource>].[<derivation:Field:pivot>] — not from a generic [${token}] example. Do NOT fall back to ` +
          'an imperative command (e.g. tabdoc:sort) to work around it; fix the reference and re-apply the XML.',
      });
    }

    return issues;
  },
};
