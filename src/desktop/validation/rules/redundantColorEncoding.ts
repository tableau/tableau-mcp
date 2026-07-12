import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';
import { parseXml } from './parseXml.js';

function norm(ref: string): string {
  return String(ref ?? '').trim();
}

export const redundantColorEncodingRule: ValidationRule = {
  id: 'redundant-color-encoding',
  description:
    'Warns when the color encoding references the same field already on rows/cols (coloring a mark by a value it already ' +
    'encodes positionally) — usually a raw-measure gradient reached for instead of a discrete group/tier encoding.',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const doc = parseXml(xml);
    if (!doc) return [];

    const issues: ValidationIssue[] = [];
    const worksheets = xpath.select('//worksheet', doc as unknown as Node) as Element[];
    const scope = worksheets.length > 0 ? worksheets : [doc.documentElement];

    for (const wsNode of scope) {
      const shelfFields = new Set<string>();
      for (const n of xpath.select('.//rows/text() | .//cols/text()', wsNode as unknown as Node) as Node[]) {
        const v = norm(n.nodeValue ?? '');
        if (v) shelfFields.add(v);
      }
      if (shelfFields.size === 0) continue;

      const colorRefs = (xpath.select('.//encodings/color/@column', wsNode as unknown as Node) as Attr[]).map((a) =>
        norm(a.value),
      );
      const seen = new Set<string>();
      for (const colorRef of colorRefs) {
        if (!colorRef || seen.has(colorRef) || !shelfFields.has(colorRef)) continue;
        seen.add(colorRef);
        issues.push({
          ruleId: 'redundant-color-encoding',
          severity: 'error',
          message:
            `Color encoding references "${colorRef}", the same field already on rows/cols — the mark is colored by a value ` +
            'it already encodes positionally (e.g. a bar colored by its own length). This is usually a raw-measure gradient.',
          xpath: '//encodings/color/@column',
          suggestion:
            'If the goal is distinct groups (top/bottom/tier), color by a DISCRETE dimension calc that buckets rows into ' +
            'named groups (see expertise://tableau/tactics/viz/marks-and-encodings → "Discrete-tier color"), not by ' +
            'the raw measure. If a gradient is genuinely intended, color by a DIFFERENT measure than the one on the axis.',
        });
      }
    }

    return issues;
  },
};
