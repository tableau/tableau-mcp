import type { ValidationIssue, ValidationRule } from '../types.js';

const TEMPLATE_TOKEN = /\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g;

export const unsubstitutedTemplateTokenRule: ValidationRule = {
  id: 'unsubstituted-template-token',
  description:
    'Errors when applied workbook/worksheet XML still contains a {{TEMPLATE}} placeholder (e.g. {{DATASOURCE}}). ' +
    'These are substituted only on the template-injection path; a raw apply leaves them verbatim, so Tableau sees ' +
    'no valid data source. Substitute the placeholder (or use the template-injection tool) before applying.',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const s = String(xml ?? '');
    const issues: ValidationIssue[] = [];
    const seen = new Set<string>();

    for (const match of s.matchAll(TEMPLATE_TOKEN)) {
      const token = match[0];
      if (seen.has(token)) continue;
      seen.add(token);

      issues.push({
        ruleId: 'unsubstituted-template-token',
        severity: 'error',
        message:
          `Unsubstituted template placeholder ${token} is present in the XML being applied. Template placeholders ` +
          `are replaced only when you inject a template; this raw apply leaves ${token} verbatim, so Tableau reports ` +
          `"the worksheet does not have a valid data source" (there is no datasource/field named ${token}).`,
        xpath: "//*[contains(.,'{{')] | //@*[contains(.,'{{')]",
        suggestion:
          `Substitute ${token} with the real value before applying — e.g. replace [${token.replace(/[{}]/g, '')}] ` +
          'references with [Sample - Superstore] and use real field instances (tableau-list-available-fields) — OR ' +
          'apply this template via the template-injection tool (tableau-inject-template / build-and-apply), which runs ' +
          'the substitution. Do NOT send template XML through a raw apply-workbook/apply-worksheet.',
      });
    }

    return issues;
  },
};
