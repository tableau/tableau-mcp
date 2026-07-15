import { describe, expect, it } from 'vitest';

import { invalidColumnInstancePivotRule as rule } from './invalidColumnInstancePivot.js';

describe('invalid-column-instance-pivot rule', () => {
  it('errors on the none:...:qk signature', () => {
    const xml =
      '<worksheet><filter column="[Sample - Superstore].[none:Order Date:qk]"/></worksheet>';
    const issues = rule.validate(xml);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('invalid-column-instance-pivot');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toMatch(/\[none:Order Date:qk\]/);
  });

  it('does not flag valid dimension instances', () => {
    const xml = `<worksheet>
      <rows>[ds].[none:Sub-Category:nk]</rows>
      <cols>[ds].[none:Order Date:ok]</cols>
    </worksheet>`;
    expect(rule.validate(xml)).toHaveLength(0);
  });

  it('does not flag valid date-trunc or aggregate instances', () => {
    const xml = `<worksheet>
      <cols>[ds].[tmn:Order Date:ok]</cols>
      <cols>[ds].[tyr:Order Date:ok]</cols>
      <color column="[ds].[sum:Profit:qk]"/>
    </worksheet>`;
    expect(rule.validate(xml)).toHaveLength(0);
  });

  it('is case-insensitive on the none prefix and dedupes repeats', () => {
    const xml = '<x a="[ds].[NONE:Order Date:qk]" b="[ds].[none:Order Date:qk]"/>';
    expect(rule.validate(xml)).toHaveLength(1);
  });

  it('flags multiple distinct bad fields', () => {
    const xml = '<x a="[ds].[none:Order Date:qk]" b="[ds].[none:Ship Date:qk]"/>';
    expect(rule.validate(xml)).toHaveLength(2);
  });

  it('returns nothing for empty or non-matching XML', () => {
    expect(rule.validate('')).toHaveLength(0);
    expect(rule.validate('<worksheet/>')).toHaveLength(0);
  });

  describe('bin exemption', () => {
    const liveHistogram = `<worksheet name="A2TD Histogram">
  <table>
    <view>
      <datasource-dependencies datasource="Sample - Superstore">
        <column aggregation="None" caption="Profit (bin 500)" datatype="integer" name="[Profit (bin 500)]" role="dimension" type="ordinal">
          <calculation class="bin" decimals="2" formula="[Profit]" peg="0" size="500" />
        </column>
        <column datatype="real" name="[Profit]" role="measure" type="quantitative" />
        <column-instance column="[Profit]" derivation="Count" name="[cnt:Profit:qk]" pivot="key" type="quantitative" />
        <column-instance column="[Profit (bin 500)]" derivation="None" name="[none:Profit (bin 500):qk]" pivot="key" type="quantitative" />
      </datasource-dependencies>
    </view>
    <rows>[Sample - Superstore].[cnt:Profit:qk]</rows>
    <cols>[Sample - Superstore].[none:Profit (bin 500):qk]</cols>
    <show-full-range>
      <column>[Sample - Superstore].[none:Profit (bin 500):qk]</column>
    </show-full-range>
  </table>
</worksheet>`;

    it('does not flag the live bin histogram payload', () => {
      expect(rule.validate(liveHistogram)).toHaveLength(0);
    });

    it('exempts a double-quoted bin column definition too', () => {
      const xml =
        '<worksheet><datasource-dependencies>' +
        '<column name="[Sales (bin)]" role="dimension" type="ordinal"><calculation class="bin" formula="[Sales]" size="100" /></column>' +
        '<column-instance column="[Sales (bin)]" derivation="None" name="[none:Sales (bin):qk]" pivot="key" type="quantitative" />' +
        '</datasource-dependencies><cols>[ds].[none:Sales (bin):qk]</cols></worksheet>';
      expect(rule.validate(xml)).toHaveLength(0);
    });

    it('still flags a non-bin none:...:qk when a real bin field is present', () => {
      const xml = liveHistogram.replace(
        '<cols>[Sample - Superstore].[none:Profit (bin 500):qk]</cols>',
        '<cols>[Sample - Superstore].[none:Profit (bin 500):qk]</cols>' +
          '<filter column="[Sample - Superstore].[none:Order Date:qk]"/>',
      );
      const issues = rule.validate(xml);
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toMatch(/\[none:Order Date:qk\]/);
    });

    it('still flags a field named like a bin with no bin calculation', () => {
      const xml =
        '<worksheet><datasource-dependencies>' +
        '<column datatype="string" name="[Region (bin)]" role="dimension" type="nominal" />' +
        '</datasource-dependencies><filter column="[ds].[none:Region (bin):qk]"/></worksheet>';
      const issues = rule.validate(xml);
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toMatch(/\[none:Region \(bin\):qk\]/);
    });

    it('does not exempt a differently-named field via a categorical-bin class', () => {
      const xml =
        '<worksheet><datasource-dependencies>' +
        '<column name="[Grade (bin)]" role="dimension" type="ordinal"><calculation class="categorical-bin" formula="[Grade]" /></column>' +
        '</datasource-dependencies><cols>[ds].[none:Grade (bin):qk]</cols></worksheet>';
      expect(rule.validate(xml)).toHaveLength(1);
    });
  });

  describe('datasource scoping and calc adjacency', () => {
    it('a bin in datasource A does not exempt an impossible none:...:qk in datasource B', () => {
      const xml = `<worksheet name="cross-ds">
  <table>
    <view>
      <datasource-dependencies datasource="A">
        <column aggregation="None" caption="Sales (bin)" datatype="integer" name="[Sales]" role="dimension" type="ordinal">
          <calculation class="bin" decimals="2" formula="[Sales]" peg="0" size="100" />
        </column>
        <column-instance column="[Sales]" derivation="None" name="[none:Sales:qk]" pivot="key" type="quantitative" />
      </datasource-dependencies>
      <datasource-dependencies datasource="B">
        <column datatype="real" name="[Sales]" role="measure" type="quantitative" />
        <column-instance column="[Sales]" derivation="None" name="[none:Sales:qk]" pivot="key" type="quantitative" />
      </datasource-dependencies>
    </view>
    <cols>[A].[none:Sales:qk]</cols>
    <filter column="[B].[none:Sales:qk]" />
  </table>
</worksheet>`;
      const issues = rule.validate(xml);
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toMatch(/\[none:Sales:qk\]/);
    });

    it('same datasource instance pointing at a non-bin field is still flagged', () => {
      const xml = `<worksheet name="same-ds-mismatch">
  <table>
    <view>
      <datasource-dependencies datasource="Sample - Superstore">
        <column aggregation="None" caption="Profit (bin)" datatype="integer" name="[Profit (bin)]" role="dimension" type="ordinal">
          <calculation class="bin" decimals="2" formula="[Profit]" peg="0" size="100" />
        </column>
        <column datatype="real" name="[Sales]" role="measure" type="quantitative" />
        <column-instance column="[Sales]" derivation="None" name="[none:Sales:qk]" pivot="key" type="quantitative" />
      </datasource-dependencies>
    </view>
    <cols>[Sample - Superstore].[none:Sales:qk]</cols>
  </table>
</worksheet>`;
      const issues = rule.validate(xml);
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toMatch(/\[none:Sales:qk\]/);
    });

    it('exempts a valid bin whose calculation is not the first child', () => {
      const xml = `<worksheet name="aliased-bin">
  <table>
    <view>
      <datasource-dependencies datasource="Sample - Superstore">
        <column aggregation="None" caption="Profit (bin)" datatype="integer" name="[Profit (bin)]" role="dimension" type="ordinal">
          <aliases enabled="true" />
          <calculation class="bin" decimals="2" formula="[Profit]" peg="0" size="100" />
        </column>
        <column-instance column="[Profit (bin)]" derivation="None" name="[none:Profit (bin):qk]" pivot="key" type="quantitative" />
      </datasource-dependencies>
    </view>
    <cols>[Sample - Superstore].[none:Profit (bin):qk]</cols>
  </table>
</worksheet>`;
      expect(rule.validate(xml)).toHaveLength(0);
    });

    it('works when bin columns and refs live outside datasource-dependencies blocks', () => {
      const xml = `<workbook>
  <datasources>
    <datasource name="Sample - Superstore">
      <column aggregation="None" caption="Profit (bin)" datatype="integer" name="[Profit (bin)]" role="dimension" type="ordinal">
        <calculation class="bin" decimals="2" formula="[Profit]" peg="0" size="283" />
      </column>
      <column datatype="real" name="[Profit]" role="measure" type="quantitative" />
      <column-instance column="[Profit (bin)]" derivation="None" name="[none:Profit (bin):qk]" pivot="key" type="quantitative" />
    </datasource>
  </datasources>
  <worksheets>
    <worksheet name="hist">
      <table>
        <cols>[Sample - Superstore].[none:Profit (bin):qk]</cols>
        <filter column="[Sample - Superstore].[none:Order Date:qk]" />
      </table>
    </worksheet>
  </worksheets>
</workbook>`;
      const issues = rule.validate(xml);
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toMatch(/\[none:Order Date:qk\]/);
    });
  });
});
