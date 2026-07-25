/**
 * Validation rule: fabricated-dependency-column
 *
 * The binder writes a field's `<column>` into `<datasource-dependencies>` from what it BELIEVES
 * the field to be (src/tools/desktop/binder/bindTemplate.ts), and until now no rule read that
 * element back. A `<column>` naming a field the datasource never declares applies without
 * complaint and resolves to nothing; a `<column datatype='string'>` under a `Month` derivation
 * additionally SILENCES date-like-string-on-time-axis, whose own header says a proper date
 * derivation suppresses the warning.
 *
 * The neighbouring rules cannot see either case. invalid-derivation-string only asks whether the
 * derivation NAME is canonical, and date-field-bound-as-string only judges fields the datasource
 * declares as a date — so a fabricated `string` declaration is silent there by design.
 *
 * False-positive safety, and why it matters here:
 *   - A datasource states its fields in three places (top-level <column>, the connection's
 *     <relation><columns>, and <metadata-records>) and Tableau writes the first only for
 *     CUSTOMISED fields. Judging against top-level <column> alone calls 153 of 153 real
 *     dependency columns fabricated on the Superstore that ships with Desktop. This rule uses
 *     all three, via collectDeclaredColumns.
 *   - A dependency <column> that owns a <calculation> declares itself and is skipped.
 *   - When the document does not carry the referenced <datasource> at all — a bare worksheet
 *     fragment — there is nothing to compare against, so the column check stays silent. The
 *     datatype check still runs, because the fragment declares the datatype itself.
 *
 * Measured across 148 real workbooks (240 dependency columns, 140 derivations), including the
 * Superstore and World Indicators that ship with Desktop: zero issues.
 */
import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';
import { bareName, collectDeclaredColumns } from './datasourceColumns.js';
import { parseXmlResult, unparseableXmlIssue } from './parseXml.js';

/** Derivations that read a date part or truncate a date; the base must BE a date. */
export const DATE_DERIVATIONS = new Set<string>([
  'Year',
  'Quarter',
  'Month',
  'Week',
  'Weekday',
  'Day',
  'Hour',
  'Minute',
  'Second',
  'MY',
  'MDY',
  'ISO-Year',
  'ISO-Qtr',
  'ISO-Week',
  'ISO-Weekday',
  'Year-Trunc',
  'ISO-Year-Trunc',
  'Quarter-Trunc',
  'ISO-Qtr-Trunc',
  'ISO-Week-Trunc',
  'Month-Trunc',
  'Week-Trunc',
  'Day-Trunc',
  'Hour-Trunc',
  'Minute-Trunc',
  'Second-Trunc',
]);

/**
 * Aggregations that need a number. Count, CountD, Min and Max are deliberately absent — they
 * are defined over any type.
 */
export const NUMERIC_AGGREGATIONS = new Set<string>([
  'Sum',
  'Avg',
  'Median',
  'Stdev',
  'StdevP',
  'Var',
  'VarP',
]);

const DATE_DATATYPES = new Set(['date', 'datetime', 'date-time']);
const NUMERIC_DATATYPES = new Set(['integer', 'real']);

export const fabricatedDependencyColumnRule: ValidationRule = {
  id: 'fabricated-dependency-column',
  description:
    'Errors when a <column> under <datasource-dependencies> names a field the referenced <datasource> never ' +
    'declares, or when a <column-instance> derivation cannot apply to its base column type (a date part over a ' +
    'string, an average over text). Both apply cleanly and then resolve to nothing.',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const parsed = parseXmlResult(xml);
    if (!parsed.ok) return [unparseableXmlIssue('fabricated-dependency-column', parsed.message)];
    const doc = parsed.doc;

    const declared = collectDeclaredColumns(doc);
    const issues: ValidationIssue[] = [];
    const seen = new Set<string>();

    for (const deps of xpath.select(
      '//datasource-dependencies[@datasource]',
      doc as unknown as Node,
    ) as Element[]) {
      const datasource = deps.getAttribute('datasource') ?? '';
      const fromDatasource = declared.get(datasource);

      // What this dependency block declares about the fields it uses.
      const local = new Map<string, { datatype: string; isCalc: boolean }>();
      for (const column of xpath.select('./column[@name]', deps as unknown as Node) as Element[]) {
        local.set(bareName(column.getAttribute('name')), {
          datatype: (column.getAttribute('datatype') ?? '').toLowerCase(),
          isCalc:
            (xpath.select('./calculation', column as unknown as Node) as Element[]).length > 0,
        });
      }

      if (fromDatasource) {
        for (const column of xpath.select(
          './column[@name]',
          deps as unknown as Node,
        ) as Element[]) {
          const name = bareName(column.getAttribute('name'));
          if (!name || local.get(name)?.isCalc) continue;
          if (fromDatasource.has(name)) continue;

          const key = `column::${datasource}::${name}`;
          if (seen.has(key)) continue;
          seen.add(key);

          issues.push({
            ruleId: 'fabricated-dependency-column',
            severity: 'error',
            message:
              `<datasource-dependencies datasource="${datasource}"> declares a <column> named ` +
              `"${column.getAttribute('name')}", but datasource "${datasource}" has no such field. The XML ` +
              'applies and the field then resolves to nothing, so the pill renders blank instead of failing.',
            xpath: `//datasource-dependencies[@datasource="${datasource}"]/column[@name="${column.getAttribute('name')}"]`,
            suggestion:
              'Use a field the datasource actually declares — call list-available-fields to see them. If the ' +
              'field is meant to be a calculation, declare it as <column ...><calculation class="tableau" ' +
              'formula="..."/></column> instead of a bare <column>.',
          });
        }
      }

      for (const instance of xpath.select(
        './column-instance[@derivation][@column]',
        deps as unknown as Node,
      ) as Element[]) {
        const derivation = instance.getAttribute('derivation') ?? '';
        const wantsDate = DATE_DERIVATIONS.has(derivation);
        const wantsNumber = NUMERIC_AGGREGATIONS.has(derivation);
        if (!wantsDate && !wantsNumber) continue;

        const base = bareName(instance.getAttribute('column'));
        const datatype = fromDatasource?.get(base)?.datatype || local.get(base)?.datatype || '';
        if (!datatype) continue;

        const compatible = wantsDate
          ? DATE_DATATYPES.has(datatype)
          : NUMERIC_DATATYPES.has(datatype);
        if (compatible) continue;

        const key = `derivation::${datasource}::${base}::${derivation}`;
        if (seen.has(key)) continue;
        seen.add(key);

        issues.push({
          ruleId: 'fabricated-dependency-column',
          severity: 'error',
          message:
            `The <column-instance> "${instance.getAttribute('name')}" applies derivation "${derivation}" to ` +
            `"${instance.getAttribute('column')}", which is declared datatype="${datatype}". A ` +
            `${wantsDate ? 'date part or truncation needs a date or datetime field' : 'numeric aggregation needs an integer or real field'}` +
            '. Tableau accepts the XML and the pill then resolves to nothing.' +
            (wantsDate
              ? ' A fabricated date derivation over a string also suppresses date-like-string-on-time-axis, ' +
                'so nothing else reports the flat categorical axis you will get.'
              : ''),
          xpath: `//datasource-dependencies[@datasource="${datasource}"]/column-instance[@name="${instance.getAttribute('name')}"]`,
          suggestion: wantsDate
            ? `Correct "${instance.getAttribute('column')}" to a date/datetime at the connection, or bind a parsed ` +
              'date calc such as DATE([Month]) and derive from that. Do not declare the base column as a date it is not.'
            : 'Use Count, CountD, Min or Max for a non-numeric field, or aggregate a field that is integer or real.',
        });
      }
    }

    return issues;
  },
};
