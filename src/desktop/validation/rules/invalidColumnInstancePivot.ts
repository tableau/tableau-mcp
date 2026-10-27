import type { ValidationIssue, ValidationRule } from '../types.js';

const INVALID_NONE_QK = /\[none:([^:\]]+):qk\]/gi;
const NAME_ATTR = /\bname=(?:'([^']*)'|"([^"]*)")/;
const COLUMN_ATTR = /\bcolumn=(?:'([^']*)'|"([^"]*)")/;
const DATASOURCE_ATTR = /\bdatasource=(?:'([^']*)'|"([^"]*)")/;
const CLASS_ATTR = /\bclass=(?:'([^']*)'|"([^"]*)")/;
const DERIVATION_ATTR = /\bderivation=(?:'([^']*)'|"([^"]*)")/;
const TYPE_ATTR = /\btype=(?:'([^']*)'|"([^"]*)")/;
const NONE_QK_NAME = /^\[none:([^:\]]+):qk\]$/i;
const COLUMN_INSTANCE_TAG = /<column-instance\b[^>]*>/gi;
const FILTER_TAG = /<filter\b[^>]*>/gi;
const RELATIVE_NONE_QK_COLUMN = /^(?:\[(.*)\]\.)?\[none:([^:\]]+):qk\]$/i;

interface ScopeBlock {
  start: number;
  end: number;
  datasource?: string;
  declaredQuantitativeInstances: Set<string>;
}

function stripOuterBrackets(name: string): string {
  return name.replace(/^\[/, '').replace(/\]$/, '');
}

function findBlocks(
  xml: string,
  tag: 'datasource-dependencies' | 'datasource' | 'worksheet' | 'slices',
): ScopeBlock[] {
  const blocks: ScopeBlock[] = [];
  const openNeedle = `<${tag}`;
  const closeNeedle = `</${tag}>`;
  let cursor = 0;

  while (cursor < xml.length) {
    const start = xml.indexOf(openNeedle, cursor);
    if (start === -1) break;
    const following = xml[start + openNeedle.length];
    if (![' ', '\t', '\n', '\r', '>', '/'].includes(following ?? '')) {
      cursor = start + openNeedle.length;
      continue;
    }
    const tagEnd = xml.indexOf('>', start);
    if (tagEnd === -1) break;
    const openTag = xml.slice(start, tagEnd + 1);
    const attribute =
      tag === 'datasource'
        ? NAME_ATTR
        : tag === 'datasource-dependencies'
          ? DATASOURCE_ATTR
          : undefined;
    const match = attribute?.exec(openTag);
    const datasource = match ? (match[1] ?? match[2]) : undefined;
    const selfClosing = xml[tagEnd - 1] === '/';
    const close = selfClosing ? tagEnd + 1 : xml.indexOf(closeNeedle, tagEnd);
    if (close === -1) break;
    const end = selfClosing ? tagEnd + 1 : close + closeNeedle.length;
    blocks.push({ start, end, datasource, declaredQuantitativeInstances: new Set() });
    cursor = end;
  }

  return blocks;
}

function blockAt(blocks: ScopeBlock[], index: number): ScopeBlock | undefined {
  return blocks.find((block) => index >= block.start && index < block.end);
}

export const invalidColumnInstancePivotRule: ValidationRule = {
  id: 'invalid-column-instance-pivot',
  description:
    'Errors when a none:...:qk reference has no exact quantitative column-instance declaration in the same datasource scope.',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const source = String(xml ?? '');
    const worksheetBlocks = findBlocks(source, 'worksheet');
    const dependencyBlocks = findBlocks(source, 'datasource-dependencies');
    const datasourceBlocks = findBlocks(source, 'datasource');
    const sliceBlocks = findBlocks(source, 'slices');
    const topLevelDeclarations = new Set<string>();

    for (const match of source.matchAll(COLUMN_INSTANCE_TAG)) {
      const tag = match[0];
      const nameAttribute = NAME_ATTR.exec(tag);
      const name = nameAttribute ? (nameAttribute[1] ?? nameAttribute[2]) : '';
      const nameMatch = name ? NONE_QK_NAME.exec(name) : null;
      if (!nameMatch) continue;
      const columnAttribute = COLUMN_ATTR.exec(tag);
      const linkedColumn = columnAttribute
        ? stripOuterBrackets(columnAttribute[1] ?? columnAttribute[2]).trim()
        : '';
      const field = nameMatch[1].trim();
      const derivationAttribute = DERIVATION_ATTR.exec(tag);
      const derivation = derivationAttribute
        ? (derivationAttribute[1] ?? derivationAttribute[2])
        : '';
      const typeAttribute = TYPE_ATTR.exec(tag);
      const type = typeAttribute ? (typeAttribute[1] ?? typeAttribute[2]) : '';
      if (linkedColumn !== field || derivation !== 'None' || type !== 'quantitative') continue;

      const index = match.index ?? 0;
      const owner = blockAt(dependencyBlocks, index) ?? blockAt(datasourceBlocks, index);
      const worksheet = blockAt(worksheetBlocks, index);
      (
        owner?.declaredQuantitativeInstances ??
        worksheet?.declaredQuantitativeInstances ??
        topLevelDeclarations
      ).add(field);
    }

    const datasourceForRef = (index: number): string | undefined => {
      if (source[index - 1] !== '.' || source[index - 2] !== ']') return undefined;
      let cursor = index - 3;
      while (
        cursor >= 0 &&
        source[cursor] !== '[' &&
        source[cursor] !== ']' &&
        source[cursor] !== '>'
      ) {
        cursor -= 1;
      }
      return cursor >= 0 && source[cursor] === '['
        ? source.slice(cursor + 1, index - 2)
        : undefined;
    };

    const relativeDateKeysByWorksheet = new Map<ScopeBlock | undefined, Set<string>>();
    const relativeDateFilterRanges: Array<{ start: number; end: number }> = [];
    const instanceKey = (field: string, datasource: string | undefined): string =>
      JSON.stringify([datasource ?? null, field]);

    for (const match of source.matchAll(FILTER_TAG)) {
      const tag = match[0];
      const classAttribute = CLASS_ATTR.exec(tag);
      const filterClass = classAttribute ? (classAttribute[1] ?? classAttribute[2]) : '';
      if (filterClass.toLowerCase() !== 'relative-date') continue;
      const columnAttribute = COLUMN_ATTR.exec(tag);
      const column = columnAttribute ? (columnAttribute[1] ?? columnAttribute[2]) : '';
      const relativeColumn = RELATIVE_NONE_QK_COLUMN.exec(column);
      if (!relativeColumn) continue;

      const index = match.index ?? 0;
      const worksheet = blockAt(worksheetBlocks, index);
      const keys = relativeDateKeysByWorksheet.get(worksheet) ?? new Set<string>();
      keys.add(instanceKey(relativeColumn[2].trim(), relativeColumn[1]));
      relativeDateKeysByWorksheet.set(worksheet, keys);
      relativeDateFilterRanges.push({ start: index, end: index + tag.length });
    }

    const isAllowedRelativeDateReference = (
      field: string,
      datasource: string | undefined,
      index: number,
    ): boolean => {
      const worksheet = blockAt(worksheetBlocks, index);
      const keys = relativeDateKeysByWorksheet.get(worksheet);
      if (!keys?.has(instanceKey(field, datasource))) return false;
      if (relativeDateFilterRanges.some((range) => index >= range.start && index < range.end)) {
        return true;
      }
      return blockAt(sliceBlocks, index) !== undefined;
    };

    const declarationExists = (
      field: string,
      datasource: string | undefined,
      referenceIndex: number,
    ): boolean => {
      const referenceWorksheet = blockAt(worksheetBlocks, referenceIndex);
      const candidates = [...dependencyBlocks, ...datasourceBlocks].filter((block) => {
        if (datasource !== undefined && block.datasource !== datasource) return false;
        const declarationWorksheet = blockAt(worksheetBlocks, block.start);
        return referenceWorksheet
          ? !declarationWorksheet || declarationWorksheet === referenceWorksheet
          : !declarationWorksheet;
      });
      return (
        referenceWorksheet?.declaredQuantitativeInstances.has(field) === true ||
        topLevelDeclarations.has(field) ||
        candidates.some((block) => block.declaredQuantitativeInstances.has(field))
      );
    };

    const issues: ValidationIssue[] = [];
    const issued = new Set<string>();
    for (const match of source.matchAll(INVALID_NONE_QK)) {
      const field = match[1].trim();
      if (issued.has(field)) continue;
      const index = match.index ?? 0;
      const datasource = datasourceForRef(index);
      if (isAllowedRelativeDateReference(field, datasource, index)) continue;
      const owner = blockAt(dependencyBlocks, index) ?? blockAt(datasourceBlocks, index);
      const declared = owner
        ? owner.declaredQuantitativeInstances.has(field)
        : declarationExists(field, datasource, index);
      if (declared) continue;

      issued.add(field);
      const ref = `[none:${field}:qk]`;
      issues.push({
        ruleId: 'invalid-column-instance-pivot',
        severity: 'error',
        message:
          `Invalid or undeclared column-instance reference ${ref}: no matching quantitative ` +
          '<column-instance derivation="None" type="quantitative"> exists in the same datasource scope. ' +
          'Tableau rejects fabricated references on load ("field … does not exist").',
        xpath: `//*[contains(text(),'${ref}')] | //@*[contains(.,'${ref}')]`,
        suggestion:
          `Use an instance declared by Desktop. If no quantitative ${ref} declaration exists, use ` +
          `[none:${field}:nk] or [none:${field}:ok] for a dimension, a date derivation for dates, ` +
          'or an aggregate such as sum: for a measure.',
      });
    }

    return issues;
  },
};
