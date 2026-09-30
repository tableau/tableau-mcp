/**
 * Validation rule: date-like-string-on-time-axis
 *
 * Heuristic companion to the stricter "field is proven date metadata" guard. This one
 * catches the CSV-inference failure mode where a field like Month is still typed as a
 * string/nominal dimension, but the worksheet is authored like a time series.
 *
 * DETECTION SIGNALS (all required):
 *   1. A rows/cols pill resolves to string/nominal metadata, or to a none:/nominal
 *      column-instance with no date derivation.
 *   2. The field name/caption contains a date-like term from DATE_LIKE_FIELD_NAME_TERMS.
 *   3. Worksheet intent looks temporal: mark class is Line/Area, or the candidate pill
 *      sits on Cols while Rows contains a continuous aggregate measure.
 *
 * False-positive safety:
 *   - Date/datetime metadata or a proper date derivation (yr/mn/tmn/tyr/etc.) suppresses
 *     the warning; the stricter date rule owns those cases.
 *   - Non-line/area categorical marks are suppressed when the same field is also used on
 *     a mark encoding such as color/label, which is the clear categorical Month-as-member
 *     shape.
 *
 * Severity: warning. The field name signal is intentionally heuristic, so a legitimate
 * categorical Month/Period dimension should be confirmable rather than blocked.
 */
import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';
import { parseXml } from './parseXml.js';

export const DATE_LIKE_FIELD_NAME_TERMS = [
  'month',
  'date',
  'day',
  'week',
  'quarter',
  'year',
  'fecha',
  'mes',
  'periodo',
  'period',
] as const;

const DATE_DERIVATION_PREFIXES = new Set([
  'yr',
  'qr',
  'mn',
  'wk',
  'dy',
  'hr',
  'mi',
  'sc',
  'tyr',
  'tqr',
  'tmn',
  'tmo',
  'twk',
  'tdy',
]);

const DATE_DERIVATION_NAMES = new Set([
  'year',
  'quarter',
  'month',
  'week',
  'weekday',
  'day',
  'hour',
  'minute',
  'second',
  'my',
  'mdy',
  'iso-year',
  'iso-qtr',
  'iso-week',
  'iso-weekday',
  'year-trunc',
  'iso-year-trunc',
  'quarter-trunc',
  'iso-qtr-trunc',
  'iso-week-trunc',
  'month-trunc',
  'week-trunc',
  'day-trunc',
  'hour-trunc',
  'minute-trunc',
  'second-trunc',
]);

const AGGREGATE_PREFIXES = new Set([
  'sum',
  'avg',
  'cnt',
  'count',
  'cntd',
  'ctd',
  'countd',
  'median',
  'min',
  'max',
  'stdev',
  'stdevp',
  'var',
  'varp',
]);

const FIELD_REF = /\[([^\]]+)\]\.\[([^\]]+)\]/g;

interface ColumnMeta {
  field: string;
  caption?: string;
  datatype?: string;
  type?: string;
  role?: string;
}

interface InstanceMeta {
  instance: string;
  column?: string;
  derivation?: string;
  type?: string;
}

interface MetadataIndex {
  columns: Map<string, ColumnMeta[]>;
  instances: Map<string, InstanceMeta[]>;
}

interface PillRef {
  ref: string;
  datasource: string;
  instance: string;
  derivation: string;
  field: string;
  pivot: string;
}

function normalizeName(s: string): string {
  return String(s ?? '')
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function stripOuterBrackets(s: string): string {
  return String(s ?? '')
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .trim();
}

function attr(el: Element, name: string): string | undefined {
  return el.getAttribute(name) ?? undefined;
}

function closestDatasourceNames(el: Element): string[] {
  const names = new Set<string>();
  let n: Node | null = el;

  while (n && n.nodeType === 1) {
    const e = n as Element;
    if (e.nodeName === 'datasource-dependencies') {
      const ds = attr(e, 'datasource');
      if (ds) names.add(ds);
    }
    if (e.nodeName === 'datasource') {
      const name = attr(e, 'name');
      const caption = attr(e, 'caption');
      if (name) names.add(name);
      if (caption) names.add(caption);
    }
    n = e.parentNode;
  }

  return [...names];
}

function addScoped<T extends { field?: string; instance?: string }>(
  map: Map<string, T[]>,
  datasourceNames: string[],
  itemName: string,
  item: T,
): void {
  const fieldKey = normalizeName(itemName);
  if (!fieldKey) return;

  const scopes = datasourceNames.length > 0 ? datasourceNames : ['*'];
  for (const ds of scopes) {
    const key = `${normalizeName(ds)}::${fieldKey}`;
    const existing = map.get(key) ?? [];
    existing.push(item);
    map.set(key, existing);
  }

  const wildcard = `*::${fieldKey}`;
  const existing = map.get(wildcard) ?? [];
  existing.push(item);
  map.set(wildcard, existing);
}

function collectMetadata(doc: Document): MetadataIndex {
  const columns = new Map<string, ColumnMeta[]>();
  const instances = new Map<string, InstanceMeta[]>();

  for (const col of xpath.select('//column[@name]', doc as unknown as Node) as Element[]) {
    const field = stripOuterBrackets(attr(col, 'name') ?? '');
    if (!field) continue;

    const meta: ColumnMeta = {
      field,
      caption: attr(col, 'caption'),
      datatype: attr(col, 'datatype')?.toLowerCase(),
      type: attr(col, 'type')?.toLowerCase(),
      role: attr(col, 'role')?.toLowerCase(),
    };
    const scope = closestDatasourceNames(col);
    addScoped(columns, scope, field, meta);
    if (meta.caption) addScoped(columns, scope, meta.caption, meta);
  }

  for (const ci of xpath.select('//column-instance[@name]', doc as unknown as Node) as Element[]) {
    const instance = stripOuterBrackets(attr(ci, 'name') ?? '');
    if (!instance) continue;

    const meta: InstanceMeta = {
      instance,
      column: stripOuterBrackets(attr(ci, 'column') ?? ''),
      derivation: attr(ci, 'derivation')?.toLowerCase(),
      type: attr(ci, 'type')?.toLowerCase(),
    };
    addScoped(instances, closestDatasourceNames(ci), instance, meta);
  }

  return { columns, instances };
}

function parseInstance(instance: string): {
  derivation: string;
  field: string;
  pivot: string;
} | null {
  const first = instance.indexOf(':');
  const last = instance.lastIndexOf(':');
  if (first <= 0 || last <= first) return null;

  return {
    derivation: instance.slice(0, first).toLowerCase(),
    field: instance.slice(first + 1, last).trim(),
    pivot: instance.slice(last + 1).toLowerCase(),
  };
}

function parseShelfRefs(shelfText: string): PillRef[] {
  const refs: PillRef[] = [];

  for (const match of String(shelfText ?? '').matchAll(FIELD_REF)) {
    const datasource = match[1];
    const instance = match[2];
    const parsed = parseInstance(instance);
    if (!parsed) continue;
    refs.push({ ref: match[0], datasource, instance, ...parsed });
  }

  return refs;
}

function lookup<T>(map: Map<string, T[]>, datasource: string, name: string): T[] {
  return [
    ...(map.get(`${normalizeName(datasource)}::${normalizeName(name)}`) ?? []),
    ...(map.get(`*::${normalizeName(name)}`) ?? []),
  ];
}

function hasDateDerivation(pill: PillRef, instances: InstanceMeta[]): boolean {
  if (DATE_DERIVATION_PREFIXES.has(pill.derivation)) return true;
  return instances.some(
    (ci) => ci.derivation !== undefined && DATE_DERIVATION_NAMES.has(ci.derivation),
  );
}

function hasDateDatatype(columns: ColumnMeta[]): boolean {
  return columns.some((col) => col.datatype === 'date' || col.datatype === 'datetime');
}

function isStringNominalPill(
  pill: PillRef,
  columns: ColumnMeta[],
  instances: InstanceMeta[],
): boolean {
  if (hasDateDatatype(columns) || hasDateDerivation(pill, instances)) return false;
  if (columns.some((col) => col.datatype === 'string' || col.type === 'nominal')) return true;
  if (
    instances.some((ci) => ci.type === 'nominal' && !DATE_DERIVATION_NAMES.has(ci.derivation ?? ''))
  ) {
    return true;
  }
  return pill.derivation === 'none' && (pill.pivot === 'nk' || pill.pivot === 'ok');
}

function hasDateLikeName(pill: PillRef, columns: ColumnMeta[]): boolean {
  const names = [pill.field, ...columns.flatMap((col) => [col.field, col.caption ?? ''])];

  return names.some((name) => {
    const normalized = normalizeName(name).replace(/[_-]+/g, ' ');
    return DATE_LIKE_FIELD_NAME_TERMS.some((term) => {
      const needle = normalizeName(term);
      return new RegExp(`(^|[^a-z0-9])${needle}([^a-z0-9]|$)`).test(normalized);
    });
  });
}

function isLineOrAreaWorksheet(wsNode: Element): boolean {
  const markClasses = (xpath.select('.//mark/@class', wsNode as unknown as Node) as Attr[]).map(
    (a) => a.value.toLowerCase(),
  );
  return markClasses.some((markClass) => markClass === 'line' || markClass === 'area');
}

function isContinuousMeasure(pill: PillRef, columns: ColumnMeta[]): boolean {
  if (pill.pivot !== 'qk') return false;
  if (DATE_DERIVATION_PREFIXES.has(pill.derivation)) return false;
  if (AGGREGATE_PREFIXES.has(pill.derivation)) return true;
  return columns.some((col) => col.role === 'measure' || col.type === 'quantitative');
}

function hasContinuousMeasureOnRows(wsNode: Element, metadata: MetadataIndex): boolean {
  const rowNodes = xpath.select('.//rows/text()', wsNode as unknown as Node) as Node[];

  for (const rowNode of rowNodes) {
    for (const pill of parseShelfRefs(rowNode.nodeValue ?? '')) {
      const columns = lookup(metadata.columns, pill.datasource, pill.field);
      if (isContinuousMeasure(pill, columns)) return true;
    }
  }

  return false;
}

function isAlsoEncoded(wsNode: Element, candidate: PillRef): boolean {
  const encoded = xpath.select('.//encodings/*/@column', wsNode as unknown as Node) as Attr[];
  return encoded.some((a) =>
    parseShelfRefs(a.value).some(
      (pill) => normalizeName(pill.ref) === normalizeName(candidate.ref),
    ),
  );
}

export const dateLikeStringOnTimeAxisRule: ValidationRule = {
  id: 'date-like-string-on-time-axis',
  description:
    'Warns when a date-like string/nominal field is placed where the worksheet otherwise looks like a time-series axis.',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const doc = parseXml(xml);
    if (!doc?.documentElement) return [];

    const metadata = collectMetadata(doc);
    const worksheets = xpath.select('//worksheet', doc as unknown as Node) as Element[];
    const scope = worksheets.length > 0 ? worksheets : [doc.documentElement];
    const issues: ValidationIssue[] = [];
    const seen = new Set<string>();

    for (const wsNode of scope) {
      const hasLineOrArea = isLineOrAreaWorksheet(wsNode);
      const hasMeasureRows = hasContinuousMeasureOnRows(wsNode, metadata);
      const worksheetName = attr(wsNode, 'name') ?? '(worksheet)';

      for (const shelf of ['rows', 'cols'] as const) {
        const shelfNodes = xpath.select(`.//${shelf}/text()`, wsNode as unknown as Node) as Node[];
        for (const shelfNode of shelfNodes) {
          for (const pill of parseShelfRefs(shelfNode.nodeValue ?? '')) {
            const columns = lookup(metadata.columns, pill.datasource, pill.field);
            const instances = lookup(metadata.instances, pill.datasource, pill.instance);
            if (!isStringNominalPill(pill, columns, instances)) continue;
            if (!hasDateLikeName(pill, columns)) continue;

            const categoricalEncoding = !hasLineOrArea && isAlsoEncoded(wsNode, pill);
            const timeIntent =
              hasLineOrArea || (shelf === 'cols' && hasMeasureRows && !categoricalEncoding);
            if (!timeIntent) continue;

            const dedupeKey = `${worksheetName}::${pill.ref}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);

            const display = columns.find((col) => col.caption)?.caption ?? pill.field;
            issues.push({
              ruleId: 'date-like-string-on-time-axis',
              severity: 'warning',
              message:
                `Field "${display}" is string/nominal but is bound as "${pill.ref}" in a time-series-shaped worksheet ` +
                `(${worksheetName}). The axis will render as flat categorical labels, not a time axis; correct the ` +
                "field's data type at the connection, bind a date-parse calc such as DATE([Month]), or confirm the " +
                'categorical intent.',
              xpath: `//worksheet[@name="${worksheetName}"]//${shelf}/text()`,
              suggestion:
                `Correct "${display}" to a date/datetime at the connection, place a parsed date calc on the shelf ` +
                '(for example DATE([Month])), or leave it only if Month/Period is intentionally categorical.',
            });
          }
        }
      }
    }

    return issues;
  },
};
