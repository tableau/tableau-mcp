import { describe, expect, it } from 'vitest';

import {
  spliceBoundCalcDefinitions,
  spliceBoundGroupDefinitions,
} from './groupDefinitionSplice.js';

/**
 * A TARGET workbook whose `Sample - Superstore` datasource dictionary defines
 * `[Product Name (group)]` as a categorical-bin group over `[Product Name]` — the exact
 * shape a Desktop-saved workbook carries. This is the authority the splice recovers from.
 */
const TARGET_WORKBOOK = `<?xml version='1.0' encoding='utf-8' ?>
<workbook>
  <datasources>
    <datasource name='Parameters' hasconnection='false'>
      <column name='[Parameters].[P1]' datatype='integer' role='measure' type='quantitative' />
    </datasource>
    <datasource name='Sample - Superstore' caption='Superstore'>
      <column datatype='string' name='[Product Name]' role='dimension' type='nominal' />
      <column caption='Manufacturer' datatype='string' name='[Product Name (group)]' role='dimension' type='nominal'>
        <calculation class='categorical-bin' column='[Product Name]' new-bin='true'>
          <bin default-name='Acme' value='&quot;Acme&quot;'>
            <value>&quot;Acme Corp Stapler&quot;</value>
            <value>&quot;Acme Corp Chair&quot;</value>
          </bin>
          <bin default-name='Globex' value='&quot;Globex&quot;'>
            <value>&quot;Globex Widget&quot;</value>
          </bin>
        </calculation>
      </column>
      <column datatype='real' name='[Profit]' role='measure' type='quantitative' />
    </datasource>
  </datasources>
</workbook>`;

/** The bound-and-rewritten worksheet: the group column is HOLLOW (no calc body). */
const HOLLOW_SHEET = `<worksheet name='chart'>
  <table>
    <view>
      <datasources>
        <datasource caption='Superstore' name='[Sample - Superstore]' />
      </datasources>
      <datasource-dependencies datasource='[Sample - Superstore]'>
        <column datatype='string' name='[Product Name (group)]' role='dimension' type='nominal'></column>
        <column-instance column='[Product Name (group)]' derivation='None' name='[none:Product Name (group):nk]' type='nominal' />
        <column datatype='real' name='[Profit]' role='measure' type='quantitative' />
        <column-instance column='[Profit]' derivation='Sum' name='[sum:Profit:qk]' type='quantitative' />
      </datasource-dependencies>
    </view>
  </table>
</worksheet>`;

// field_mapping VALUE spellings the binder emits: qualified [ds].[deriv:Field:suffix].
const GROUP_MAPPING = {
  Facet: '[Sample - Superstore].[none:Product Name (group):nk]',
  Measure: '[Sample - Superstore].[sum:Profit:qk]',
};

describe('spliceBoundGroupDefinitions', () => {
  it('fills a hollow bound group column with the categorical-bin body from the target', () => {
    const out = spliceBoundGroupDefinitions(HOLLOW_SHEET, GROUP_MAPPING, TARGET_WORKBOOK);

    // The categorical-bin body is now inline in the worksheet dependencies.
    // (serializeXML emits double-quoted attributes; assert quote-agnostically.)
    expect(out).toMatch(/class=["']categorical-bin["']/);
    expect(out).toMatch(/column=["']\[Product Name\]["']/);
    expect(out).toContain('&quot;Acme Corp Stapler&quot;');
    expect(out).toContain('&quot;Globex Widget&quot;');
    // The hollow, body-less form is gone.
    expect(out).not.toMatch(/name=["']\[Product Name \(group\)\]["'][^>]*><\/column>/);
    expect(out).not.toMatch(/name=["']\[Product Name \(group\)\]["'][^>]*\/>/);
  });

  it('materializes the referenced base column alongside the group', () => {
    const out = spliceBoundGroupDefinitions(HOLLOW_SHEET, GROUP_MAPPING, TARGET_WORKBOOK);
    // Both the group and its base [Product Name] are declared in the sheet dependencies.
    const productNameCols = out.match(/<column[^>]*\bname=["']\[Product Name\]["']/g) ?? [];
    expect(productNameCols.length).toBe(1);
  });

  it('preserves numeric control-character references in an inline group definition', () => {
    const target = TARGET_WORKBOOK.replace(
      '&quot;Acme Corp Stapler&quot;',
      '&quot;Acme&#13;&#10;Corp Stapler&quot;',
    );

    const out = spliceBoundGroupDefinitions(HOLLOW_SHEET, GROUP_MAPPING, target);

    expect(out).toContain('&quot;Acme&#13;&#10;Corp Stapler&quot;');
    expect(out).not.toContain('&amp;#13;');
    expect(out).not.toContain('&amp;#10;');
  });

  it('does not duplicate a base column the sheet already declares', () => {
    const sheetWithBase = HOLLOW_SHEET.replace(
      "<column datatype='string' name='[Product Name (group)]' role='dimension' type='nominal'></column>",
      "<column datatype='string' name='[Product Name]' role='dimension' type='nominal' />\n" +
        "        <column datatype='string' name='[Product Name (group)]' role='dimension' type='nominal'></column>",
    );
    const out = spliceBoundGroupDefinitions(sheetWithBase, GROUP_MAPPING, TARGET_WORKBOOK);
    const productNameCols = out.match(/<column[^>]*\bname=["']\[Product Name\]["']/g) ?? [];
    expect(productNameCols.length).toBe(1);
  });

  it('is an identity no-op when no bound field is a group', () => {
    const nonGroupMapping = {
      Level: '[Sample - Superstore].[none:Product Name:nk]',
      Measure: '[Sample - Superstore].[sum:Profit:qk]',
    };
    const sheet = HOLLOW_SHEET.replace('Product Name (group)', 'Product Name').replace(
      'Product Name (group)',
      'Product Name',
    );
    expect(spliceBoundGroupDefinitions(sheet, nonGroupMapping, TARGET_WORKBOOK)).toBe(sheet);
  });

  it('is an identity no-op when the target defines no groups', () => {
    const plainTarget = TARGET_WORKBOOK.replace(
      /<column caption='Manufacturer'[\s\S]*?<\/column>/,
      "<column datatype='string' name='[Category]' role='dimension' type='nominal' />",
    );
    expect(spliceBoundGroupDefinitions(HOLLOW_SHEET, GROUP_MAPPING, plainTarget)).toBe(
      HOLLOW_SHEET,
    );
  });

  it('is an identity no-op with an empty field mapping', () => {
    expect(spliceBoundGroupDefinitions(HOLLOW_SHEET, {}, TARGET_WORKBOOK)).toBe(HOLLOW_SHEET);
    expect(spliceBoundGroupDefinitions(HOLLOW_SHEET, undefined, TARGET_WORKBOOK)).toBe(
      HOLLOW_SHEET,
    );
  });

  it('leaves a group column that already carries a body untouched', () => {
    // If the sheet somehow already has the body, the hollow regex must not match, so no change.
    const alreadyBodied = spliceBoundGroupDefinitions(HOLLOW_SHEET, GROUP_MAPPING, TARGET_WORKBOOK);
    const twice = spliceBoundGroupDefinitions(alreadyBodied, GROUP_MAPPING, TARGET_WORKBOOK);
    expect(twice).toBe(alreadyBodied);
  });
});

const CALC_WORKBOOK = `<?xml version='1.0' encoding='utf-8' ?>
<workbook>
  <datasources>
    <datasource name='Parameters' hasconnection='false'>
      <column name='[Parameters].[P1]' datatype='integer' />
    </datasource>
    <datasource name='federated.xyz' caption='Superstore'>
      <column datatype='real' name='[Sales]' role='measure' type='quantitative' />
      <column datatype='real' name='[Profit]' role='measure' type='quantitative' />
      <column datatype='real' name='[Profit Ratio]' role='measure' type='quantitative'>
        <calculation class='tableau' formula='SUM([Profit])/SUM([Sales])' />
      </column>
    </datasource>
  </datasources>
</workbook>`;

const HOLLOW_CALC_SHEET = `<worksheet name='chart'>
  <table>
    <view>
      <datasources>
        <datasource caption='Superstore' name='[federated.xyz]' />
      </datasources>
      <datasource-dependencies datasource='[federated.xyz]'>
        <column datatype='real' name='[Profit Ratio]' role='measure' type='quantitative' />
        <column-instance column='[Profit Ratio]' derivation='Sum' name='[sum:Profit Ratio:qk]' type='quantitative' />
      </datasource-dependencies>
    </view>
  </table>
</worksheet>`;

const CALC_MAPPING = {
  Measure: '[federated.xyz].[sum:Profit Ratio:qk]',
};

describe('spliceBoundCalcDefinitions', () => {
  it('fills a hollow bound calc column with the tableau formula body from the target', () => {
    const out = spliceBoundCalcDefinitions(HOLLOW_CALC_SHEET, CALC_MAPPING, CALC_WORKBOOK);

    expect(out).toMatch(/class=["']tableau["']/);
    expect(out).toMatch(/formula=["']SUM\(\[Profit\]\)\/SUM\(\[Sales\]\)["']/);
    expect(out).not.toMatch(/name=["']\[Profit Ratio\]["'][^>]*\/>/);
    expect(out).not.toMatch(/name=["']\[Profit Ratio\]["'][^>]*><\/column>/);
  });

  it('materializes formula-referenced dep columns alongside the calc', () => {
    const out = spliceBoundCalcDefinitions(HOLLOW_CALC_SHEET, CALC_MAPPING, CALC_WORKBOOK);

    expect(out).toMatch(/<column[^>]*\bname=["']\[Sales\]["']/);
    expect(out).toMatch(/<column[^>]*\bname=["']\[Profit\]["']/);
  });

  it('does not duplicate a dep column the sheet already declares', () => {
    const sheetWithSales = HOLLOW_CALC_SHEET.replace(
      "<column datatype='real' name='[Profit Ratio]'",
      "<column datatype='real' name='[Sales]' role='measure' type='quantitative' />\n" +
        "        <column datatype='real' name='[Profit Ratio]'",
    );
    const out = spliceBoundCalcDefinitions(sheetWithSales, CALC_MAPPING, CALC_WORKBOOK);
    const salesCols = out.match(/<column[^>]*\bname=["']\[Sales\]["']/g) ?? [];
    expect(salesCols.length).toBe(1);
  });

  it('does not duplicate the calc when two slots map to the same field', () => {
    const dupeMapping = {
      Measure1: '[federated.xyz].[sum:Profit Ratio:qk]',
      Measure2: '[federated.xyz].[avg:Profit Ratio:qk]',
    };
    const out = spliceBoundCalcDefinitions(HOLLOW_CALC_SHEET, dupeMapping, CALC_WORKBOOK);
    const ratioCols = out.match(/<column[^>]*\bname=["']\[Profit Ratio\]["']/g) ?? [];
    expect(ratioCols.length).toBe(1);
  });

  it('is an identity no-op when no bound field is a user calc', () => {
    const nonCalcMapping = { Level: '[federated.xyz].[sum:Sales:qk]' };
    expect(spliceBoundCalcDefinitions(HOLLOW_CALC_SHEET, nonCalcMapping, CALC_WORKBOOK)).toBe(
      HOLLOW_CALC_SHEET,
    );
  });

  it('is an identity no-op when the target defines no user calcs', () => {
    const noCalcWorkbook = CALC_WORKBOOK.replace(
      /<column datatype='real' name='\[Profit Ratio\]'[\s\S]*?<\/column>/,
      "<column datatype='real' name='[Units]' role='measure' type='quantitative' />",
    );
    expect(spliceBoundCalcDefinitions(HOLLOW_CALC_SHEET, CALC_MAPPING, noCalcWorkbook)).toBe(
      HOLLOW_CALC_SHEET,
    );
  });

  it('is an identity no-op with an empty field mapping', () => {
    expect(spliceBoundCalcDefinitions(HOLLOW_CALC_SHEET, {}, CALC_WORKBOOK)).toBe(
      HOLLOW_CALC_SHEET,
    );
    expect(spliceBoundCalcDefinitions(HOLLOW_CALC_SHEET, undefined, CALC_WORKBOOK)).toBe(
      HOLLOW_CALC_SHEET,
    );
  });

  it('leaves a calc column that already carries a body untouched', () => {
    const alreadyBodied = spliceBoundCalcDefinitions(
      HOLLOW_CALC_SHEET,
      CALC_MAPPING,
      CALC_WORKBOOK,
    );
    const twice = spliceBoundCalcDefinitions(alreadyBodied, CALC_MAPPING, CALC_WORKBOOK);
    expect(twice).toBe(alreadyBodied);
  });
});
