import type { ValidationIssue, ValidationRule } from '../types.js';

const INVALID_NONE_QK = /\[none:([^:\]]+):qk\]/gi;
const NAME_ATTR = /\bname=(?:'([^']*)'|"([^"]*)")/;
const COLUMN_ATTR = /\bcolumn=(?:'([^']*)'|"([^"]*)")/;
const DATASOURCE_ATTR = /\bdatasource=(?:'([^']*)'|"([^"]*)")/;
const BIN_CALC = /<calculation\b[^>]*\bclass=(?:'bin'|"bin")/i;
const NONE_QK_NAME = /^\[none:([^:\]]+):qk\]$/i;
const DEP_OPEN = '<datasource-dependencies';
const DEP_CLOSE = '</datasource-dependencies>';
const COLUMN_INSTANCE_TAG = /<column-instance\b[^>]*>/gi;

function stripOuterBrackets(name: string): string {
  return name.replace(/^\[/, '').replace(/\]$/, '');
}

interface DepBlock {
  start: number;
  end: number;
  ds?: string;
  binCols: Set<string>;
  exempt: Set<string>;
}

function findDependencyBlocks(s: string): DepBlock[] {
  const blocks: DepBlock[] = [];
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf(DEP_OPEN, i);
    if (open === -1) break;
    const tagEnd = s.indexOf('>', open);
    if (tagEnd === -1) break;
    const openTag = s.slice(open, tagEnd + 1);
    const dm = DATASOURCE_ATTR.exec(openTag);
    const ds = dm ? (dm[1] ?? dm[2]) : undefined;
    if (s[tagEnd - 1] === '/') {
      blocks.push({ start: open, end: tagEnd + 1, ds, binCols: new Set(), exempt: new Set() });
      i = tagEnd + 1;
      continue;
    }
    const close = s.indexOf(DEP_CLOSE, tagEnd);
    if (close === -1) break;
    blocks.push({ start: open, end: close + DEP_CLOSE.length, ds, binCols: new Set(), exempt: new Set() });
    i = close + DEP_CLOSE.length;
  }
  return blocks;
}

function blockAt(blocks: DepBlock[], idx: number): DepBlock | undefined {
  for (const block of blocks) {
    if (idx < block.start) return undefined;
    if (idx < block.end) return block;
  }
  return undefined;
}

function collectBinColumns(s: string, blocks: DepBlock[], topBinCols: Set<string>): void {
  let i = 0;
  while (i < s.length) {
    i = s.indexOf('<column', i);
    if (i === -1) break;
    const after = s[i + '<column'.length];
    if (after !== ' ' && after !== '\t' && after !== '\n' && after !== '\r' && after !== '>' && after !== '/') {
      i += '<column'.length;
      continue;
    }
    const tagEnd = s.indexOf('>', i);
    if (tagEnd === -1) break;
    if (s[tagEnd - 1] === '/') {
      i = tagEnd + 1;
      continue;
    }
    const close = s.indexOf('</column>', tagEnd);
    if (close === -1) break;
    const openTag = s.slice(i, tagEnd + 1);
    const inner = s.slice(tagEnd + 1, close);
    const nm = NAME_ATTR.exec(openTag);
    const name = nm ? (nm[1] ?? nm[2]) : '';
    if (name && BIN_CALC.test(inner)) {
      const owner = blockAt(blocks, i);
      (owner ? owner.binCols : topBinCols).add(stripOuterBrackets(name).trim());
    }
    i = close + '</column>'.length;
  }
}

export const invalidColumnInstancePivotRule: ValidationRule = {
  id: 'invalid-column-instance-pivot',
  description:
    'Errors when a column-instance reference pairs a dimension derivation (none:) with a quantitative-key ' +
    'pivot (:qk) — an impossible instance (e.g. [none:Order Date:qk]) that Tableau rejects on load and that ' +
    'can destabilize Desktop when re-applied repeatedly.',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const s = String(xml ?? '');
    const issues: ValidationIssue[] = [];
    const blocks = findDependencyBlocks(s);
    const topBinCols = new Set<string>();
    const topExempt = new Set<string>();

    collectBinColumns(s, blocks, topBinCols);

    for (const m of s.matchAll(COLUMN_INSTANCE_TAG)) {
      const tag = m[0];
      const nm = NAME_ATTR.exec(tag);
      const name = nm ? (nm[1] ?? nm[2]) : '';
      const nameMatch = name ? NONE_QK_NAME.exec(name) : null;
      if (!nameMatch) continue;
      const cm = COLUMN_ATTR.exec(tag);
      const linkedCol = cm ? stripOuterBrackets(cm[1] ?? cm[2]).trim() : '';
      if (!linkedCol) continue;
      const field = nameMatch[1].trim();
      const owner = blockAt(blocks, m.index ?? 0);
      const scopeBinCols = owner ? owner.binCols : topBinCols;
      const scopeExempt = owner ? owner.exempt : topExempt;
      if (scopeBinCols.has(linkedCol)) scopeExempt.add(field);
    }

    const refDatasource = (idx: number): string | undefined => {
      if (s[idx - 1] !== '.' || s[idx - 2] !== ']') return undefined;
      let j = idx - 3;
      while (j >= 0 && s[j] !== '[' && s[j] !== ']' && s[j] !== '>') j -= 1;
      if (j < 0 || s[j] !== '[') return undefined;
      return s.slice(j + 1, idx - 2);
    };

    const exemptForRef = (field: string, ds: string | undefined): boolean => {
      if (topExempt.has(field)) return true;
      if (ds !== undefined) {
        const matching = blocks.filter((b) => b.ds === ds);
        if (matching.length > 0) return matching.some((b) => b.exempt.has(field));
      }
      return blocks.some((b) => b.exempt.has(field));
    };

    const issued = new Set<string>();
    for (const m of s.matchAll(INVALID_NONE_QK)) {
      const field = m[1].trim();
      if (issued.has(field)) continue;
      const idx = m.index ?? 0;
      const owner = blockAt(blocks, idx);
      const isExempt = owner ? owner.exempt.has(field) : exemptForRef(field, refDatasource(idx));
      if (isExempt) continue;
      issued.add(field);
      const ref = `[none:${field}:qk]`;
      issues.push({
        ruleId: 'invalid-column-instance-pivot',
        severity: 'error',
        message:
          `Invalid column-instance reference ${ref}: a dimension instance (none: / derivation="None") cannot have a ` +
          'quantitative-key pivot (:qk). No such instance exists — Tableau rejects it on load ("field … does not exist"), ' +
          'and repeated re-applies of the invalid XML can destabilize Desktop.',
        xpath: `//*[contains(text(),'${ref}')] | //@*[contains(.,'${ref}')]`,
        suggestion:
          `Use a valid pivot for the field's role: a discrete dimension is [none:${field}:nk] (nominal) or ` +
          `[none:${field}:ok] (ordinal); a date part/trunc is e.g. [tmn:${field}:ok] / [tyr:${field}:ok]; a measure ` +
          `aggregate is [sum:${field}:qk] etc. Build the reference from a real field instance (tableau-list-available-fields), ` +
          'not by pairing none: with :qk.',
      });
    }

    return issues;
  },
};
