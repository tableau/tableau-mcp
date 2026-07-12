/**
 * Validation rule: date-field-bound-as-string
 *
 * Live eval failure (casepack-e4-mau-line): a monthly active users line chart passed
 * structural checks while binding Month on the time axis as `[none:month:nk]` — a
 * raw nominal string pill. The visual rendered as a flat categorical axis, not a
 * temporal axis, so the analytical answer was wrong even though the shelves existed.
 *
 * Precision boundary:
 *   - Only fields whose datasource metadata declares `datatype='date'`/`datetime`
 *     are judged. A string field named "Month" stays silent.
 *   - Only Rows/Cols are inspected. Filters and mark encodings can legitimately use
 *     categorical date members or labels without defining the view's time axis; this
 *     rule blocks the axis defect that caused the eval failure.
 *   - Only raw `none:<field>:nk|ok` refs are flagged. Date derivations such as
 *     `[mn:Date:ok]`, `[tmn:Date:qk]`, and `[tyr:Date:qk]` stay silent.
 */
import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';
import { parseXml } from './parseXml.js';

interface ShelfRef {
  datasource?: string;
  field: string;
  instance: string;
  pivot: 'nk' | 'ok';
}

const DATE_DATATYPES = new Set(['date', 'datetime', 'date-time']);
const RAW_STRING_AXIS_REF = /(?:\[([^\]]+)\]\.)?\[none:([^:\]]+):(nk|ok)\]/gi;

function normalizeFieldName(name: string): string {
  return name.trim().replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

function datasourceName(el: Element): string | undefined {
  return el.getAttribute('name') ?? el.getAttribute('datasource') ?? undefined;
}

function addDateColumns(
  container: Element,
  datasource: string | undefined,
  out: Map<string, Set<string>>,
): void {
  const columns = xpath.select(
    './/column[@datatype and @name]',
    container as unknown as Node,
  ) as Element[];
  const key = datasource ?? '';

  for (const column of columns) {
    const datatype = (column.getAttribute('datatype') ?? '').toLowerCase();
    if (!DATE_DATATYPES.has(datatype)) continue;

    const name = normalizeFieldName(column.getAttribute('name') ?? '');
    if (!name) continue;

    const fields = out.get(key) ?? new Set<string>();
    fields.add(name);
    out.set(key, fields);
  }
}

function collectDateFieldsByDatasource(doc: Document): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();

  for (const datasource of xpath.select(
    '//datasource[@name]',
    doc as unknown as Node,
  ) as Element[]) {
    addDateColumns(datasource, datasourceName(datasource), out);
  }

  for (const deps of xpath.select(
    '//datasource-dependencies',
    doc as unknown as Node,
  ) as Element[]) {
    addDateColumns(deps, datasourceName(deps), out);
  }

  return out;
}

function findRawStringDateAxisRefs(text: string): ShelfRef[] {
  const refs: ShelfRef[] = [];

  for (const match of text.matchAll(RAW_STRING_AXIS_REF)) {
    const datasource = match[1];
    const field = match[2].trim();
    const pivot = match[3].toLowerCase() as 'nk' | 'ok';
    refs.push({
      datasource,
      field,
      instance: `none:${field}:${pivot}`,
      pivot,
    });
  }

  return refs;
}

function isDatasourceDeclaredDate(
  ref: ShelfRef,
  dateFieldsByDatasource: Map<string, Set<string>>,
  allDateFields: Set<string>,
): boolean {
  const field = normalizeFieldName(ref.field);
  if (ref.datasource !== undefined) {
    return dateFieldsByDatasource.get(ref.datasource)?.has(field) ?? false;
  }
  return allDateFields.has(field);
}

export const dateFieldBoundAsStringRule: ValidationRule = {
  id: 'date-field-bound-as-string',
  description:
    'Errors when a datasource-declared date/datetime field is bound to Rows/Cols as a raw none: nominal/ordinal ' +
    'string pill, producing a categorical axis instead of a time axis.',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const doc = parseXml(xml);
    if (!doc?.documentElement) return [];

    const dateFieldsByDatasource = collectDateFieldsByDatasource(doc);
    const allDateFields = new Set<string>();
    for (const fields of dateFieldsByDatasource.values()) {
      for (const field of fields) allDateFields.add(field);
    }
    if (allDateFields.size === 0) return [];

    const issues: ValidationIssue[] = [];
    const issued = new Set<string>();
    const shelves = xpath.select('//rows | //cols', doc as unknown as Node) as Element[];

    for (const shelf of shelves) {
      const shelfText = xpath.select('string(.)', shelf as unknown as Node) as string;
      for (const ref of findRawStringDateAxisRefs(shelfText)) {
        if (!isDatasourceDeclaredDate(ref, dateFieldsByDatasource, allDateFields)) continue;

        const key = `${shelf.nodeName}:${ref.datasource ?? ''}:${ref.field}:${ref.pivot}`;
        if (issued.has(key)) continue;
        issued.add(key);

        const fieldLabel = ref.datasource
          ? `[${ref.datasource}].[${ref.instance}]`
          : `[${ref.instance}]`;
        issues.push({
          ruleId: 'date-field-bound-as-string',
          severity: 'error',
          message:
            `Date field "${ref.field}" is bound on ${shelf.nodeName} as raw string pill ${fieldLabel}. ` +
            'It renders as a flat categorical axis, not a time axis, so a line or trend over time is analytically wrong.',
          xpath: `//${shelf.nodeName}[contains(.,'${ref.instance}')]`,
          suggestion:
            `FIX: Bind "${ref.field}" with a date derivation or continuous date pill, e.g. ` +
            `[tmn:${ref.field}:qk] for continuous month, [tmn:${ref.field}:ok] / [tqr:${ref.field}:ok] / ` +
            `[tyr:${ref.field}:ok] for discrete truncations, instead of [none:${ref.field}:${ref.pivot}].`,
        });
      }
    }

    return issues;
  },
};
