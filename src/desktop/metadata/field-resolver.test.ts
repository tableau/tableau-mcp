import { resolveField } from './field-resolver.js';

const WB_TWO_DATASOURCES = `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <datasources>
    <datasource name="ds1" caption="Sample - Superstore">
      <column name="[Profit]" datatype="real" role="measure" type="quantitative"/>
      <column name="[Region]" datatype="string" role="dimension" type="nominal"/>
    </datasource>
    <datasource name="ds2" caption="Sample - Coffee Chain">
      <column name="[Profit]" datatype="real" role="measure" type="quantitative"/>
    </datasource>
  </datasources>
</workbook>`;

const WB_AGGREGATED_CALC = `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <datasources>
    <datasource name="ds1" caption="Sample - Superstore">
      <column name="[Profit]" datatype="real" role="measure" type="quantitative"/>
      <column name="[Profit Ratio]" datatype="real" role="measure" type="quantitative" caption="Profit Ratio">
        <calculation class="tableau" formula="SUM([Profit])/SUM([Sales])"/>
      </column>
    </datasource>
  </datasources>
</workbook>`;

describe('resolveField', () => {
  it('should return ambiguous when the same field name exists in two datasources', () => {
    const r = resolveField(WB_TWO_DATASOURCES, 'Profit');
    expect(r.kind).toBe('ambiguous');
    expect(r.candidates?.length).toBe(2);
    const datasources = new Set(r.candidates!.map((c) => c.datasource));
    expect(datasources).toContain('ds1');
    expect(datasources).toContain('ds2');
  });

  it('should resolve exactly when a datasource is supplied to break the ambiguity', () => {
    const r = resolveField(WB_TWO_DATASOURCES, 'Profit', { datasource: 'ds1' });
    expect(r.kind).toBe('exact');
    expect(r.column_ref).toContain('[ds1]');
    expect(r.datasource).toBe('ds1');
  });

  it('should return not_found for an empty query', () => {
    const r = resolveField(WB_TWO_DATASOURCES, '');
    expect(r.kind).toBe('not_found');
    expect(r.candidates).toEqual([]);
  });

  it('should return not_found with did-you-mean candidates for a near-miss', () => {
    const r = resolveField(WB_TWO_DATASOURCES, 'Profitt', { datasource: 'ds1' });
    expect(r.kind).toBe('not_found');
    expect(r.candidates && r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates![0].column_name).toBe('[Profit]');
  });

  it('should rewrite "sum of Profit" to a sum-aggregated column_ref', () => {
    const r = resolveField(WB_TWO_DATASOURCES, 'sum of Profit', { datasource: 'ds1' });
    expect(r.kind).toBe('rewritten');
    expect(r.rewrites).toContain('parsed-aggregation-prefix');
    expect(r.column_ref).toMatch(/\[sum:Profit:qk\]/);
  });

  it('should strip brackets from "[Region]" as a normalized rewrite', () => {
    const r = resolveField(WB_TWO_DATASOURCES, '[Region]', { datasource: 'ds1' });
    expect(r.kind).toBe('rewritten');
    expect(r.rewrites).toContain('normalized-brackets');
  });

  it('should ignore redundant aggregation on an already-aggregated calc field', () => {
    const r = resolveField(WB_AGGREGATED_CALC, 'sum of Profit Ratio', { datasource: 'ds1' });
    expect(r.kind).toBe('rewritten');
    expect(r.rewrites).toContain('ignored-redundant-aggregation');
    expect(r.reason).toMatch(/already aggregated/);
  });
});
