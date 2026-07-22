import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';

export const worksheetMissingWindowRule: ValidationRule = {
  id: 'worksheet-missing-window',
  description:
    'Rejects when a worksheet has no matching worksheet-class <window> entry; Tableau silently ' +
    'drops worksheets without a window (the sheet never appears).',
  contexts: ['workbook'],

  validate(xml: string): ValidationIssue[] {
    const doc = parseXml(xml);
    if (!doc?.documentElement) return [];

    const worksheets = xpath.select(
      '//worksheets/worksheet[@name]',
      doc as unknown as Node,
    ) as Element[];
    if (worksheets.length === 0) return [];

    const windows = xpath.select('//windows/window[@name]', doc as unknown as Node) as Element[];
    const worksheetWindowNames = new Set(
      windows
        .filter((w) => {
          const cls = w.getAttribute('class');
          return cls === null || cls === '' || cls === 'worksheet';
        })
        .map((w) => w.getAttribute('name'))
        .filter((name): name is string => Boolean(name)),
    );

    const issues: ValidationIssue[] = [];
    for (const worksheet of worksheets) {
      const name = worksheet.getAttribute('name');
      if (!name || worksheetWindowNames.has(name)) continue;

      issues.push({
        ruleId: 'worksheet-missing-window',
        severity: 'error',
        message:
          `Worksheet "${name}" has no matching <window name="${name}"> entry. Tableau silently drops ` +
          'worksheets that lack a window — the sheet will not appear at all. Submit the worksheet and its ' +
          `<window class="worksheet" name="${name}"> together in the same tableau-apply-workbook call (unless ` +
          'the window already exists in the open workbook).',
        xpath: `//worksheets/worksheet[@name="${name}"]`,
        suggestion:
          `Add a <window class="worksheet" name="${name}"> in <windows> alongside the worksheet, ` +
          'matching the worksheet name exactly.',
      });
    }

    return issues;
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
