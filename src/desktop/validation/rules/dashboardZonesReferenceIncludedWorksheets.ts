/**
 * Validation rule: dashboard-zones-reference-included-worksheets
 *
 * Whole-workbook apply is authoritative: sheets omitted from the document are pruned
 * after the workbook POST. A document that keeps a dashboard while omitting a
 * worksheet referenced by one of that dashboard's sheet zones cannot converge because
 * Tableau silently refuses to delete worksheets still referenced by live dashboard zones.
 *
 * Scope is deliberately workbook-only. Per-dashboard applies post minimal workbook
 * documents that omit worksheets by design; those live worksheets are preserved by the
 * upsert-only path and must not be rejected by this whole-workbook consistency check.
 */
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';

function issueFor(dashboardName: string, worksheetName: string): ValidationIssue {
  return {
    ruleId: 'dashboard-zones-reference-included-worksheets',
    severity: 'error',
    message:
      `Dashboard "${dashboardName}" references worksheet "${worksheetName}" from a zone, ` +
      'but that worksheet is omitted from this whole-workbook document; include the worksheet ' +
      'in the document or remove the zone.',
    xpath: `//dashboard[@name=${JSON.stringify(dashboardName)}]//zone[@name=${JSON.stringify(
      worksheetName,
    )}]`,
    suggestion: 'Include the worksheet in the document or remove the zone.',
  };
}

export const dashboardZonesReferenceIncludedWorksheetsRule: ValidationRule = {
  id: 'dashboard-zones-reference-included-worksheets',
  description:
    'Rejects whole-workbook documents whose dashboard sheet zones reference worksheets omitted from <worksheets>.',
  contexts: ['workbook'],

  validate(xml: string): ValidationIssue[] {
    let doc: Document;
    try {
      const parser = new DOMParser({ errorHandler: () => {} });
      doc = parser.parseFromString(xml.trim() || '<empty/>', 'text/xml') as unknown as Document;
    } catch {
      // Malformed XML is reported by well-formed-xml; this rule has nothing to say.
      return [];
    }

    const worksheetNames = new Set(
      (xpath.select('//worksheets/worksheet[@name]', doc as unknown as Node) as Element[])
        .map((worksheet) => worksheet.getAttribute('name'))
        .filter((name): name is string => !!name),
    );

    const dashboards = xpath.select(
      '//dashboards/dashboard[@name]',
      doc as unknown as Node,
    ) as Element[];
    const issues: ValidationIssue[] = [];
    const seen = new Set<string>();

    for (const dashboard of dashboards) {
      const dashboardName = dashboard.getAttribute('name');
      if (!dashboardName) continue;

      // Worksheet zones are represented as <zone name="Worksheet Name" .../>. Layout,
      // text, and blank zones carry type-v2 and do not name worksheets.
      const worksheetZones = xpath.select(
        './/zone[@name and not(@type-v2)]',
        dashboard as unknown as Node,
      ) as Element[];

      for (const zone of worksheetZones) {
        const worksheetName = zone.getAttribute('name');
        if (!worksheetName || worksheetNames.has(worksheetName)) continue;

        const key = `${dashboardName}\u0000${worksheetName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        issues.push(issueFor(dashboardName, worksheetName));
      }
    }

    return issues;
  },
};
