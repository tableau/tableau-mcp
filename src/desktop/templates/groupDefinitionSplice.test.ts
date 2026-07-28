import { describe, expect, it } from 'vitest';

import { spliceBoundGroupDefinitions } from './groupDefinitionSplice.js';

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
