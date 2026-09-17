import { describe, expect, it } from 'vitest';

import { type Datasource, datasourceOf, toDatasources } from '../metadata/datasource.js';
import { resolveField } from './resolve.js';

const WB = `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <datasources>
    <datasource name="ds1" caption="Sample - Superstore">
      <column name="[Profit]" datatype="real" role="measure" type="quantitative"/>
      <column name="[Sales]" datatype="real" role="measure" type="quantitative"/>
      <column name="[Region]" datatype="string" role="dimension" type="nominal"/>
      <column name="[Profit Ratio]" datatype="real" role="measure" type="quantitative" caption="Profit Ratio">
        <calculation class="tableau" formula="SUM([Profit])/SUM([Sales])"/>
      </column>
    </datasource>
    <datasource name="ds2" caption="Coffee Chain">
      <column name="[Profit]" datatype="real" role="measure" type="quantitative"/>
    </datasource>
  </datasources>
</workbook>`;

function ds1(): Datasource {
  return toDatasources(WB).find((d) => d.name === 'ds1')!;
}

describe('resolveField (per-datasource heuristics)', () => {
  it('resolves an exact bare name to the default instance', () => {
    const r = resolveField(ds1(), 'Sales');
    expect(r.kind).toBe('exact');
    expect(r.match?.name).toBe('[Sales]');
    expect(r.field?.column_ref).toBe('[ds1].[sum:Sales:qk]');
  });

  it('resolves an exact caption', () => {
    const r = resolveField(ds1(), 'Profit Ratio');
    expect(r.kind).toBe('exact');
    expect(r.match?.name).toBe('[Profit Ratio]');
  });

  it('resolves an exact column_ref within the datasource', () => {
    const r = resolveField(ds1(), '[ds1].[sum:Profit:qk]');
    expect(r.kind).toBe('exact');
    expect(r.field?.column_ref).toBe('[ds1].[sum:Profit:qk]');
  });

  it('does not fuzzy-match a qualified ref that misses', () => {
    const r = resolveField(ds1(), '[ds1].[sum:Nope:qk]');
    expect(r.kind).toBe('not_found');
  });

  it('parses an aggregation prefix when enabled', () => {
    const r = resolveField(ds1(), 'average of Sales', { aggregationPrefix: true });
    expect(r.kind).toBe('rewritten');
    expect(r.rewrites).toContain('parsed-aggregation-prefix');
    expect(r.field?.column_ref).toBe('[ds1].[avg:Sales:qk]');
  });

  it('never re-aggregates an already-aggregated calc', () => {
    const r = resolveField(ds1(), 'sum of Profit Ratio', { aggregationPrefix: true });
    expect(r.kind).toBe('rewritten');
    expect(r.rewrites).toContain('ignored-redundant-aggregation');
    // usr derivation, not sum
    expect(r.field?.column_ref).toBe('[ds1].[usr:Profit Ratio:qk]');
  });

  it('falls back to a fuzzy did-you-mean', () => {
    const r = resolveField(ds1(), 'Salez');
    expect(r.kind).toBe('fuzzy');
    expect(r.match?.name).toBe('[Sales]');
  });

  it('is scoped to the datasource it is asked (no cross-datasource bleed)', () => {
    // ds2 also has [Profit]; asking ds1 only ever returns ds1's.
    const r = resolveField(ds1(), 'Profit');
    expect(r.kind).toBe('exact');
    expect(datasourceOf(r.field!)).toBe('ds1');
  });
});
