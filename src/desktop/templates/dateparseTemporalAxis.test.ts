import { describe, expect, it } from 'vitest';

import { type DateparseAxisSpec, spliceDateparseTemporalAxis } from './dateparseTemporalAxis.js';

// Minimal trend-line template shape: the [Order Date] date base column, its Month-Trunc
// CI on <cols>, and the same CI referenced in a <format> node — mirrors
// src/desktop/data/templates/trend-line-chart.xml.
const TREND_XML = `<workbook>
  <worksheets><worksheet name='{{TITLE}}'><table><view>
    <datasource-dependencies datasource='{{DATASOURCE}}'>
      <column datatype='date' name='[Order Date]' role='dimension' type='ordinal' />
      <column datatype='real' name='[Sales]' role='measure' type='quantitative' />
      <column-instance column='[Sales]' derivation='Sum' name='[sum:Sales:qk]' pivot='key' type='quantitative' />
      <column-instance column='[Order Date]' derivation='Month-Trunc' name='[tmn:Order Date:qk]' pivot='key' type='quantitative' />
    </datasource-dependencies>
    </view>
    <style><style-rule element='axis'>
      <format attr='title' field='[{{DATASOURCE}}].[tmn:Order Date:qk]' scope='cols' value='' />
    </style-rule></style>
    <rows>[{{DATASOURCE}}].[sum:Sales:qk]</rows>
    <cols>[{{DATASOURCE}}].[tmn:Order Date:qk]</cols>
  </table></worksheet></worksheets>
</workbook>`;

const SPEC: DateparseAxisSpec = {
  templateField: 'Order Date',
  sourceField: 'month',
  format: 'yyyy-MM',
};

describe('spliceDateparseTemporalAxis', () => {
  it('is identity when no dateparse axis is requested (null spec)', () => {
    expect(spliceDateparseTemporalAxis(TREND_XML, null)).toBe(TREND_XML);
  });

  it('is identity when the template lacks the temporal base column', () => {
    const noOrderDate = TREND_XML.replace(/\[Order Date\]/g, '[Ship Date]').replace(
      /\[tmn:Order Date:qk\]/g,
      '[tmn:Ship Date:qk]',
    );
    // spec still names "Order Date" → template has no such column → identity
    expect(spliceDateparseTemporalAxis(noOrderDate, SPEC)).toBe(noOrderDate);
  });

  it('converts the temporal base column into a DATEPARSE calc (date datatype preserved)', () => {
    const out = spliceDateparseTemporalAxis(TREND_XML, SPEC);
    // the base column is now a calc with the DATEPARSE formula (apostrophes XML-escaped)
    expect(out).toMatch(
      /<column[^>]*\bname='\[Order Date\]'[^>]*>\s*<calculation class='tableau' formula='DATEPARSE\(&apos;yyyy-MM&apos;, \[month\]\)' \/>\s*<\/column>/,
    );
    // date datatype preserved so Month-Trunc keeps operating on a date
    expect(out).toMatch(/<column[^>]*datatype='date'[^>]*\bname='\[Order Date\]'/);
  });

  it('declares the bound string source column so the formula resolves', () => {
    const out = spliceDateparseTemporalAxis(TREND_XML, SPEC);
    expect(out).toContain(
      "<column datatype='string' name='[month]' role='dimension' type='nominal' />",
    );
  });

  it('leaves the Month-Trunc CI and every shelf/format reference BYTE-UNCHANGED', () => {
    const out = spliceDateparseTemporalAxis(TREND_XML, SPEC);
    // the CI declaration is untouched
    expect(out).toContain(
      "<column-instance column='[Order Date]' derivation='Month-Trunc' name='[tmn:Order Date:qk]' pivot='key' type='quantitative' />",
    );
    // shelf pill + format ref untouched (no repointing, no duplicate-name risk)
    expect(out).toContain('<cols>[{{DATASOURCE}}].[tmn:Order Date:qk]</cols>');
    expect(out).toContain("field='[{{DATASOURCE}}].[tmn:Order Date:qk]'");
    // exactly ONE CI declaration named [tmn:Order Date:qk] (no duplication)
    const ciDecls = (out.match(/name='\[tmn:Order Date:qk\]'/g) ?? []).length;
    expect(ciDecls).toBe(1);
  });

  it('is idempotent — a second pass does not double-wrap the calc', () => {
    const once = spliceDateparseTemporalAxis(TREND_XML, SPEC);
    const twice = spliceDateparseTemporalAxis(once, SPEC);
    expect(twice).toBe(once);
  });

  it('does not re-declare the source column when it is already present', () => {
    // month already declared (e.g. also bound elsewhere)
    const withMonth = TREND_XML.replace(
      "<column datatype='real' name='[Sales]'",
      "<column datatype='string' name='[month]' role='dimension' type='nominal' />\n      <column datatype='real' name='[Sales]'",
    );
    const out = spliceDateparseTemporalAxis(withMonth, SPEC);
    const monthDecls = (out.match(/name='\[month\]'/g) ?? []).length;
    expect(monthDecls).toBe(1);
  });

  it('fail-closed: throws when the temporal base column is not in self-closing form', () => {
    // Base column already has children (not self-closing) but is NOT a calc → cannot
    // safely convert; the regex won't match the self-closing form and we throw.
    const weird = TREND_XML.replace(
      "<column datatype='date' name='[Order Date]' role='dimension' type='ordinal' />",
      "<column datatype='date' name='[Order Date]' role='dimension' type='ordinal'><foo/></column>",
    );
    expect(() => spliceDateparseTemporalAxis(weird, SPEC)).toThrow(
      /not found in self-closing form/,
    );
  });

  it('escapes XML-significant characters in the source field and format', () => {
    const spec: DateparseAxisSpec = { ...SPEC, sourceField: "Mon<'>th", format: 'MM/dd/yyyy' };
    const out = spliceDateparseTemporalAxis(TREND_XML, spec);
    expect(out).toContain('&lt;');
    expect(out).toContain('&apos;');
    // raw unescaped source name must not appear inside the formula
    expect(out).not.toContain("[Mon<'>th]");
  });
});
