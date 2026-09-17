import { describe, expect, it } from 'vitest';

import {
  baseFieldNameOf,
  type Datasource,
  datasourceOf,
  defaultInstance,
  derivationOf,
  instantiate,
  toDatasources,
} from './datasource.js';
import { listAvailableFields } from './field-builder.js';
import { AggregationType } from './types.js';

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

describe('toDatasources', () => {
  it('groups fields under their owning datasource', () => {
    const dss = toDatasources(WB);
    expect(dss.map((d) => d.name).sort()).toEqual(['ds1', 'ds2']);
    expect(
      ds1()
        .fields.map((f) => f.name)
        .sort(),
    ).toEqual(['[Profit Ratio]', '[Profit]', '[Region]', '[Sales]']);
  });

  it('discriminates field kinds', () => {
    const fields = ds1().fields;
    expect(fields.find((f) => f.name === '[Sales]')!.kind).toBe('column');
    const calc = fields.find((f) => f.name === '[Profit Ratio]')!;
    expect(calc.kind).toBe('calculation');
    expect(calc.kind === 'calculation' && calc.formula).toContain('SUM([Profit])');
    // The pre-aggregated calc is flagged so it is never re-aggregated.
    expect(calc.isAggregated).toBe(true);
  });
});

describe('defaultInstance parity with listAvailableFields', () => {
  it('reconstructs exactly the column_ref the builder bakes on (no stored ref)', () => {
    const rows = listAvailableFields(WB);
    const dss = toDatasources(WB);
    for (const ds of dss) {
      for (const field of ds.fields) {
        const rebuilt = defaultInstance(ds, field).column_ref;
        const original = rows.find(
          (r) => r.datasource === ds.name && r.columnName === field.name,
        )!.column_ref;
        expect(rebuilt).toBe(original);
      }
    }
  });
});

describe('FieldInstance accessors derive from the ref', () => {
  it('exposes datasource / base name / derivation without stored fields', () => {
    const ds = ds1();
    const sales = ds.fields.find((f) => f.name === '[Sales]')!;
    const inst = instantiate(ds, sales, AggregationType.Avg);
    expect(inst.column_ref).toBe('[ds1].[avg:Sales:qk]');
    expect(datasourceOf(inst)).toBe('ds1');
    expect(baseFieldNameOf(inst)).toBe('[Sales]');
    expect(derivationOf(inst)).toBe('avg');
  });
});
