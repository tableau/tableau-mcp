import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';
import { allDeclaredCalcNames, bareName, collectDeclaredColumns } from './datasourceColumns.js';
import { parseXmlResult, unparseableXmlIssue } from './parseXml.js';

/**
 * A reference to an auto-named calc, optionally qualified by a datasource:
 * `[federated.abc].[none:Calculation_123456789:nk]`, or a bare `[Calculation_123456789]`.
 */
const CALC_REF = /(?:\[([^[\]]*)\]\.)?\[([^[\]]*Calculation_\d{6,}[^[\]]*)\]/g;
const CALC_SEGMENT = /Calculation_\d{6,}/;

/**
 * The base column name a reference resolves to. A column-instance ref is
 * `<derivation>:<column>:<pivot>`, and the column segment is the one carrying the calc id —
 * which also keeps the `_tpl_<suffix>` that namespaceTemplateCalcColumns appends to BOTH the
 * declaration and the reference, so a correctly namespaced template still matches.
 */
function baseColumnName(inner: string): string {
  const segments = inner.split(':');
  return segments.find((segment) => CALC_SEGMENT.test(segment)) ?? inner;
}

/**
 * Where a calc reference actually costs the worksheet its contents: the shelves, the
 * dependency block, the mark encodings, the filters and the sorts.
 *
 * Deliberately NOT everywhere the id appears. Real workbooks carry stale calc ids in inert
 * places — highlight configuration, tooltip runs, manual-sort dictionaries, style-rule maps.
 * The Superstore that ships with Desktop holds 6 such leftovers and renders fine; scanning
 * every attribute and text node flags them and would refuse every apply against that workbook.
 */
const LOAD_BEARING_REFS = [
  '//rows/text()',
  '//cols/text()',
  '//slices/column/text()',
  '//datasource-dependencies/column-instance/@column',
  '//datasource-dependencies/column-instance/@name',
  '//encodings/*/@column',
  '//filter/@column',
  '//computed-sort/@column',
  '//computed-sort/@using',
  '//sort/@column',
  '//sort/@using',
].join(' | ');

/** The datasource a bare (unqualified) reference belongs to, from its dependency block. */
function enclosingDatasource(node: Node): string | undefined {
  let current: Node | null = node.nodeType === 2 ? (node as Attr).ownerElement : node.parentNode;
  while (current) {
    const element = current as Element;
    if (element.nodeType === 1 && element.nodeName === 'datasource-dependencies') {
      return element.getAttribute('datasource') ?? undefined;
    }
    current = current.parentNode;
  }
  return undefined;
}

export const undeclaredCalcReferenceRule: ValidationRule = {
  id: 'undeclared-calc-reference',
  description:
    'Errors when a worksheet references an auto-named calc (Calculation_<digits>) that is never declared as a ' +
    "<column> in the datasource. The XML applies but the calc resolves to nothing — Tableau reports 'no valid data " +
    "source' and destructively removes the worksheet's contents. Declare the calc as a <column> with a <calculation> " +
    'child before referencing it.',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    // Parsed, not string-matched. The old `<column\b` search also matched `<column-instance`
    // (n->- is a word boundary), so the column-instance every real worksheet carries for a
    // pill made the reference declare itself and the rule never fired on a real document.
    const parsed = parseXmlResult(xml);
    if (!parsed.ok) return [unparseableXmlIssue('undeclared-calc-reference', parsed.message)];
    const doc = parsed.doc;

    const declared = collectDeclaredColumns(doc);
    const anywhere = allDeclaredCalcNames(declared);

    const issues: ValidationIssue[] = [];
    const seen = new Set<string>();

    const refNodes = xpath.select(LOAD_BEARING_REFS, doc as unknown as Node) as Node[];

    for (const node of refNodes) {
      const value = node.nodeType === 2 ? (node as Attr).value : (node.nodeValue ?? '');
      if (!value || !CALC_SEGMENT.test(value)) continue;

      for (const match of value.matchAll(CALC_REF)) {
        const datasource = match[1] || enclosingDatasource(node);
        const base = baseColumnName(match[2]);
        const bare = bareName(base);

        // Resolve against the datasource the reference names when the document defines it;
        // otherwise the document cannot say which one, so accept a declaration anywhere.
        const bucket = datasource ? declared.get(datasource) : undefined;
        const isDeclared = bucket ? (bucket.get(bare)?.isCalc ?? false) : anywhere.has(bare);
        if (isDeclared) continue;

        const key = `${datasource ?? ''}::${bare}`;
        if (seen.has(key)) continue;
        seen.add(key);

        issues.push({
          ruleId: 'undeclared-calc-reference',
          severity: 'error',
          message:
            `The calc "${base}" is referenced (e.g. [none:${base}:nk]) but never declared as a <column> in the ` +
            `datasource${datasource ? ` "${datasource}"` : ''}. The XML applies, but "${base}" resolves to nothing, ` +
            'so Tableau reports "the worksheet does not have a valid data source" and REMOVES the worksheet\'s ' +
            'contents (a populated chart goes blank). A <column-instance> is a usage, not a declaration.',
          xpath: `//*[contains(.,'${base}')] | //@*[contains(.,'${base}')]`,
          suggestion:
            `Declare the calc BEFORE referencing it: add <column caption='<name>' name='[${base}]' datatype='...' ` +
            "role='...' type='...'><calculation class='tableau' formula='<the formula>'/></column> to the datasource, " +
            'then reference it. Or use a real, already-defined field. Do NOT put a bare Calculation_<id> on a shelf ' +
            'without its <column> definition — Tableau will delete the worksheet.',
        });
      }
    }

    return issues;
  },
};
