import {
  formatCanonicalColumnRef,
  parseCanonicalColumnRef,
  resolveField,
} from './field-resolver.js';

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

const WB_DUPLICATE_DATASOURCE_CAPTIONS = `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <datasources>
    <datasource name="ds1" caption="Shared Caption">
      <column name="[Profit]" datatype="real" role="measure" type="quantitative"/>
    </datasource>
    <datasource name="ds2" caption="Shared Caption">
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

const WB_NEAR_DUPLICATES = `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <datasources>
    <datasource name="football" caption="Football">
      <column name="[Country]" datatype="string" role="dimension" type="nominal"/>
      <column name="[Country1]" datatype="string" role="dimension" type="nominal"/>
      <column name="[Goals For]" datatype="integer" role="measure" type="quantitative"/>
      <column name="[Goals For1]" datatype="integer" role="measure" type="quantitative"/>
    </datasource>
  </datasources>
</workbook>`;

const WB_CAPTION_EXACT = `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <datasources>
    <datasource name="football" caption="Football">
      <column name="[Country Code]" caption="Country" datatype="string" role="dimension" type="nominal"/>
      <column name="[Country]" datatype="string" role="dimension" type="nominal"/>
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

  it('resolves an exact column_ref as already disambiguated', () => {
    const r = resolveField(WB_TWO_DATASOURCES, '[ds2].[sum:Profit:qk]');
    expect(r.kind).toBe('exact');
    expect(r.column_ref).toBe('[ds2].[sum:Profit:qk]');
    expect(r.datasource).toBe('ds2');
  });

  it('returns not_found for a column_ref-shaped miss without fuzzy fallback', () => {
    const r = resolveField(WB_TWO_DATASOURCES, '[missing_ds].[sum:Profit:qk]');
    expect(r.kind).toBe('not_found');
    expect(r.candidates).toEqual([]);
  });

  it('collapses ambiguity when a unique datasource caption is supplied', () => {
    const r = resolveField(WB_TWO_DATASOURCES, 'Profit', {
      datasource: 'Sample - Coffee Chain',
    });
    expect(r.kind).toBe('exact');
    expect(r.column_ref).toBe('[ds2].[sum:Profit:qk]');
    expect(r.datasource).toBe('ds2');
  });

  it('returns ambiguous when the datasource caption selector is not unique', () => {
    const r = resolveField(WB_DUPLICATE_DATASOURCE_CAPTIONS, 'Profit', {
      datasource: 'Shared Caption',
    });
    expect(r.kind).toBe('ambiguous');
    expect(r.candidates?.map((c) => c.datasource).sort()).toEqual(['ds1', 'ds2']);
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

  it('uses an exact caption match before a same-name column match', () => {
    const r = resolveField(WB_CAPTION_EXACT, 'Country');
    expect(r.kind).toBe('exact');
    expect(r.column_ref).toBe('[football].[none:Country Code:nk]');
  });

  it('uses the unsuffixed twin and includes a cleanup note for near-duplicate columns', () => {
    const r = resolveField(WB_NEAR_DUPLICATES, 'Country');
    expect(r.kind).toBe('exact');
    expect(r.column_ref).toBe('[football].[none:Country:nk]');
    expect(r.notes).toEqual([
      'dataset has near-duplicate columns Country/Country1 - used Country; consider cleaning the source',
    ]);
  });

  it('carries the near-duplicate note through aggregation rewrites', () => {
    const r = resolveField(WB_NEAR_DUPLICATES, 'sum of Goals For');
    expect(r.kind).toBe('rewritten');
    expect(r.column_ref).toBe('[football].[sum:Goals For:qk]');
    expect(r.notes?.[0]).toContain('Goals For/Goals For1');
  });
});

describe('canonical column_ref helpers', () => {
  it.each([
    {
      datasource: 'federated.ds2',
      derivation: 'sum',
      localFieldName: 'Profit',
      pivot: 'qk',
    },
    {
      datasource: 'Orders.Primary',
      derivation: 'none',
      localFieldName: 'Customer.Segment',
      pivot: 'nk',
    },
    {
      datasource: 'Calculations',
      derivation: 'usr',
      localFieldName: 'Profit:Ratio',
      pivot: 'qk',
    },
    {
      datasource: 'Dates',
      derivation: 'yr',
      localFieldName: 'Order.Date:Fiscal',
      pivot: 'ok',
    },
  ])('round-trips canonical refs for $datasource / $localFieldName', (parts) => {
    expect(parseCanonicalColumnRef(formatCanonicalColumnRef(parts))).toEqual({
      ...parts,
      columnInstanceName: `[${parts.derivation}:${parts.localFieldName}:${parts.pivot}]`,
    });
  });

  it('returns null for datasource-qualified refs that are not canonical instances', () => {
    expect(parseCanonicalColumnRef('[Sample].[Profit]')).toBeNull();
  });
});
