import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import {
  DATE_DERIVATIONS,
  fabricatedDependencyColumnRule,
  NUMERIC_AGGREGATIONS,
} from './fabricatedDependencyColumn.js';
import { CANONICAL_DERIVATIONS } from './invalidDerivationString.js';

const WINDOWS = "<windows><window class='worksheet' name='S'/></windows>";

function workbook(datasourceExtra: string, deps: string, shelves: string): string {
  return `<?xml version='1.0'?><workbook>
<datasources><datasource caption='Sample' name='federated.abc'>
  <column caption='Order Month' datatype='string' name='[Order Month]' role='dimension' type='nominal' />
  <column caption='Sales' datatype='real' name='[Sales]' role='measure' type='quantitative' />${datasourceExtra}
</datasource></datasources>
<worksheets><worksheet name='S'><table>
  <view><datasource-dependencies datasource='federated.abc'>
    <column-instance column='[Sales]' derivation='Sum' name='[sum:Sales:qk]' pivot='key' type='quantitative' />
    ${deps}
  </datasource-dependencies></view>
  <rows>[federated.abc].[sum:Sales:qk]</rows>
  ${shelves}
</table></worksheet></worksheets>${WINDOWS}</workbook>`;
}

describe('fabricated-dependency-column rule', () => {
  it('errors on a dependency <column> the datasource never declares', () => {
    const xml = workbook(
      '',
      `<column datatype='string' name='[Region Name]' role='dimension' type='nominal' />
       <column-instance column='[Region Name]' derivation='None' name='[none:Region Name:nk]' pivot='key' type='nominal' />`,
      '<cols>[federated.abc].[none:Region Name:nk]</cols>',
    );

    const issues = fabricatedDependencyColumnRule.validate(xml);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toMatch(/Region Name/);
    expect(runValidation(xml, 'workbook').valid).toBe(false);
  });

  it('errors on a date derivation over a column declared as a string', () => {
    const xml = workbook(
      '',
      `<column datatype='string' name='[Order Month]' role='dimension' type='nominal' />
       <column-instance column='[Order Month]' derivation='Month' name='[mn:Order Month:qk]' pivot='key' type='quantitative' />`,
      '<cols>[federated.abc].[mn:Order Month:qk]</cols>',
    );

    const issues = fabricatedDependencyColumnRule.validate(xml);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toMatch(/date part or truncation needs a date/);
    expect(runValidation(xml, 'workbook').valid).toBe(false);
  });

  it('names the warning the fabricated derivation would otherwise silence', () => {
    const xml = workbook(
      '',
      `<column datatype='string' name='[Order Month]' role='dimension' type='nominal' />
       <column-instance column='[Order Month]' derivation='Month' name='[mn:Order Month:qk]' pivot='key' type='quantitative' />`,
      '<cols>[federated.abc].[mn:Order Month:qk]</cols>',
    );

    // The derivation suppresses date-like-string-on-time-axis by design, so this rule has to
    // be the one that speaks.
    const result = runValidation(xml, 'workbook');
    expect(result.issues.some((i) => i.ruleId === 'date-like-string-on-time-axis')).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'fabricated-dependency-column')).toBe(true);
  });

  it('errors on a numeric aggregation over a string column', () => {
    const xml = workbook(
      '',
      "<column-instance column='[Order Month]' derivation='Avg' name='[avg:Order Month:qk]' pivot='key' type='quantitative' />",
      '<cols>[federated.abc].[avg:Order Month:qk]</cols>',
    );

    const issues = fabricatedDependencyColumnRule.validate(xml);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/numeric aggregation needs an integer or real/);
  });

  it('stays silent on a dependency column the datasource does declare', () => {
    const xml = workbook(
      '',
      "<column datatype='real' name='[Sales]' role='measure' type='quantitative' />",
      '<cols>[federated.abc].[sum:Sales:qk]</cols>',
    );

    expect(fabricatedDependencyColumnRule.validate(xml)).toHaveLength(0);
  });

  it('stays silent when the datasource declares the field only in its relation columns', () => {
    const xml = `<?xml version='1.0'?><workbook>
<datasources><datasource caption='Sample' name='federated.abc'>
  <connection class='federated'><relation name='orders' type='table'><columns>
    <column datatype='string' name='Region Name' ordinal='0' />
  </columns></relation></connection>
</datasource></datasources>
<worksheets><worksheet name='S'><table><view><datasource-dependencies datasource='federated.abc'>
  <column datatype='string' name='[Region Name]' role='dimension' type='nominal' />
</datasource-dependencies></view></table></worksheet></worksheets>${WINDOWS}</workbook>`;

    expect(fabricatedDependencyColumnRule.validate(xml)).toHaveLength(0);
  });

  it('stays silent when the datasource declares the field only in its metadata records', () => {
    const xml = `<?xml version='1.0'?><workbook>
<datasources><datasource caption='Sample' name='federated.abc'>
  <connection class='federated'><metadata-records>
    <metadata-record class='column'><local-name>[Region Name]</local-name><local-type>string</local-type></metadata-record>
  </metadata-records></connection>
</datasource></datasources>
<worksheets><worksheet name='S'><table><view><datasource-dependencies datasource='federated.abc'>
  <column datatype='string' name='[Region Name]' role='dimension' type='nominal' />
</datasource-dependencies></view></table></worksheet></worksheets>${WINDOWS}</workbook>`;

    expect(fabricatedDependencyColumnRule.validate(xml)).toHaveLength(0);
  });

  it('stays silent on a dependency column that declares its own calculation', () => {
    const xml = workbook(
      '',
      `<column datatype='real' name='[Profit Ratio]' role='measure' type='quantitative'>
         <calculation class='tableau' formula='SUM([Sales])' />
       </column>`,
      '',
    );

    expect(fabricatedDependencyColumnRule.validate(xml)).toHaveLength(0);
  });

  it('stays silent when the document does not carry the referenced datasource', () => {
    const fragment = `<worksheet name='S'><table><view><datasource-dependencies datasource='federated.abc'>
      <column datatype='string' name='[Region Name]' role='dimension' type='nominal' />
    </datasource-dependencies></view></table></worksheet>`;

    expect(fabricatedDependencyColumnRule.validate(fragment)).toHaveLength(0);
  });

  it('still judges the derivation in a bare fragment, where the datatype is declared locally', () => {
    const fragment = `<worksheet name='S'><table><view><datasource-dependencies datasource='federated.abc'>
      <column datatype='string' name='[Order Month]' role='dimension' type='nominal' />
      <column-instance column='[Order Month]' derivation='Month' name='[mn:Order Month:qk]' pivot='key' type='quantitative' />
    </datasource-dependencies></view></table></worksheet>`;

    expect(fabricatedDependencyColumnRule.validate(fragment)).toHaveLength(1);
  });

  it('does not constrain derivations that work on any type', () => {
    for (const derivation of ['None', 'Attribute', 'Count', 'CountD', 'Min', 'Max', 'User']) {
      const xml = workbook(
        '',
        `<column-instance column='[Order Month]' derivation='${derivation}' name='[x:Order Month:qk]' pivot='key' type='quantitative' />`,
        '',
      );
      expect(fabricatedDependencyColumnRule.validate(xml)).toHaveLength(0);
    }
  });

  it('accepts a date derivation over a real date column', () => {
    const xml = workbook(
      "\n  <column caption='Order Date' datatype='date' name='[Order Date]' role='dimension' type='ordinal' />",
      "<column-instance column='[Order Date]' derivation='Month-Trunc' name='[tmn:Order Date:qk]' pivot='key' type='quantitative' />",
      '<cols>[federated.abc].[tmn:Order Date:qk]</cols>',
    );

    expect(fabricatedDependencyColumnRule.validate(xml)).toHaveLength(0);
  });

  it('keeps its derivation lists inside the canonical set', () => {
    for (const derivation of [...DATE_DERIVATIONS, ...NUMERIC_AGGREGATIONS]) {
      expect(CANONICAL_DERIVATIONS.has(derivation)).toBe(true);
    }
  });
});
