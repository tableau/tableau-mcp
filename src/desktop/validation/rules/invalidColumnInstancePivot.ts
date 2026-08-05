import type { ValidationIssue, ValidationRule } from '../types.js';

const INVALID_NONE_QK = /\[none:([^:\]]+):qk\]/gi;
const NAME_ATTR = /\bname=(?:'([^']*)'|"([^"]*)")/;
const COLUMN_ATTR = /\bcolumn=(?:'([^']*)'|"([^"]*)")/;
const DATASOURCE_ATTR = /\bdatasource=(?:'([^']*)'|"([^"]*)")/;
const DERIVATION_ATTR = /\bderivation=(?:'([^']*)'|"([^"]*)")/;
const TYPE_ATTR = /\btype=(?:'([^']*)'|"([^"]*)")/;
const NONE_QK_NAME = /^\[none:([^:\]]+):qk\]$/i;
const DEP_OPEN = '<datasource-dependencies';
const DEP_CLOSE = '</datasource-dependencies>';
const DATASOURCE_OPEN = '<datasource';
const DATASOURCE_CLOSE = '</datasource>';
const COLUMN_INSTANCE_TAG = /<column-instance\b[^>]*>/gi;

function stripOuterBrackets(name: string): string {
  return name.replace(/^\[/, '').replace(/\]$/, '');
}

interface DepBlock {
  start: number;
  end: number;
  ds?: string;
  declaredQuantitativeInstances: Set<string>;
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
      blocks.push({
        start: open,
        end: tagEnd + 1,
        ds,
        declaredQuantitativeInstances: new Set(),
      });
      i = tagEnd + 1;
      continue;
    }
    const close = s.indexOf(DEP_CLOSE, tagEnd);
    if (close === -1) break;
    blocks.push({
      start: open,
      end: close + DEP_CLOSE.length,
      ds,
      declaredQuantitativeInstances: new Set(),
    });
    i = close + DEP_CLOSE.length;
  }
  return blocks;
}

function findDatasourceBlocks(s: string): DepBlock[] {
  const blocks: DepBlock[] = [];
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf(DATASOURCE_OPEN, i);
    if (open === -1) break;
    const after = s[open + DATASOURCE_OPEN.length];
    if (![' ', '\t', '\n', '\r', '>', '/'].includes(after ?? '')) {
      i = open + DATASOURCE_OPEN.length;
      continue;
    }
    const tagEnd = s.indexOf('>', open);
    if (tagEnd === -1) break;
    const openTag = s.slice(open, tagEnd + 1);
    const nm = NAME_ATTR.exec(openTag);
    const ds = nm ? (nm[1] ?? nm[2]) : undefined;
    if (s[tagEnd - 1] === '/') {
      blocks.push({
        start: open,
        end: tagEnd + 1,
        ds,
        declaredQuantitativeInstances: new Set(),
      });
      i = tagEnd + 1;
      continue;
    }
    const close = s.indexOf(DATASOURCE_CLOSE, tagEnd);
    if (close === -1) break;
    blocks.push({
      start: open,
      end: close + DATASOURCE_CLOSE.length,
      ds,
      declaredQuantitativeInstances: new Set(),
    });
    i = close + DATASOURCE_CLOSE.length;
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

export const invalidColumnInstancePivotRule: ValidationRule = {
  id: 'invalid-column-instance-pivot',
  description:
    'Errors when a none:...:qk reference has no exact quantitative column-instance declaration in the same ' +
    'datasource scope. Desktop emits declared instances natively, but rejects undeclared or fabricated references.',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const s = String(xml ?? '');
    const issues: ValidationIssue[] = [];
    const blocks = findDependencyBlocks(s);
    const datasourceBlocks = findDatasourceBlocks(s);
    const topDeclaredQuantitativeInstances = new Set<string>();

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
      if (linkedCol !== field) continue;
      const dm = DERIVATION_ATTR.exec(tag);
      const derivation = dm ? (dm[1] ?? dm[2]) : '';
      if (derivation !== 'None') continue;
      const tm = TYPE_ATTR.exec(tag);
      const type = tm ? (tm[1] ?? tm[2]) : '';
      if (type !== 'quantitative') continue;
      const owner = blockAt(blocks, m.index ?? 0) ?? blockAt(datasourceBlocks, m.index ?? 0);
      (owner ? owner.declaredQuantitativeInstances : topDeclaredQuantitativeInstances).add(field);
    }

    const refDatasource = (idx: number): string | undefined => {
      if (s[idx - 1] !== '.' || s[idx - 2] !== ']') return undefined;
      let j = idx - 3;
      while (j >= 0 && s[j] !== '[' && s[j] !== ']' && s[j] !== '>') j -= 1;
      if (j < 0 || s[j] !== '[') return undefined;
      return s.slice(j + 1, idx - 2);
    };

    const exemptForRef = (field: string, ds: string | undefined): boolean => {
      if (ds !== undefined) {
        const matching = [...blocks, ...datasourceBlocks].filter((b) => b.ds === ds);
        return matching.some((b) => b.declaredQuantitativeInstances.has(field));
      }
      return topDeclaredQuantitativeInstances.has(field);
    };

    const issued = new Set<string>();
    for (const m of s.matchAll(INVALID_NONE_QK)) {
      const field = m[1].trim();
      if (issued.has(field)) continue;
      const idx = m.index ?? 0;
      const owner = blockAt(blocks, idx) ?? blockAt(datasourceBlocks, idx);
      const isExempt = owner
        ? owner.declaredQuantitativeInstances.has(field)
        : exemptForRef(field, refDatasource(idx));
      if (isExempt) continue;
      issued.add(field);
      const ref = `[none:${field}:qk]`;
      issues.push({
        ruleId: 'invalid-column-instance-pivot',
        severity: 'error',
        message:
          `Invalid or undeclared column-instance reference ${ref}: no matching quantitative ` +
          '<column-instance derivation="None" type="quantitative"> exists in the same datasource scope. ' +
          'Tableau rejects fabricated references on load ("field … does not exist"), and repeated re-applies of ' +
          'the invalid XML can destabilize Desktop.',
        xpath: `//*[contains(text(),'${ref}')] | //@*[contains(.,'${ref}')]`,
        suggestion:
          `Use an instance declared by Desktop. If no quantitative ${ref} declaration exists, a discrete dimension is ` +
          `[none:${field}:nk] (nominal) or ` +
          `[none:${field}:ok] (ordinal); a date part/trunc is e.g. [tmn:${field}:ok] / [tyr:${field}:ok]; a measure ` +
          `aggregate is [sum:${field}:qk] etc. Build the reference from a real field instance (tableau-list-available-fields), ` +
          'not by pairing none: with :qk.',
      });
    }

    return issues;
  },
};
