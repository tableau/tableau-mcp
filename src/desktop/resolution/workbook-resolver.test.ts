import { describe, expect, it } from 'vitest';

import {
  type FieldResolution,
  type FieldResolveOptions,
  resolveField,
} from '../metadata/field-resolver.js';
import { resolveFieldViaDomain } from './workbook-resolver.js';

// Same fixtures the legacy resolver test uses — the domain adapter is checked
// against the legacy resolver as the parity oracle on each one.

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

const WB_CAPTION_PROVENANCE = `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <datasources>
    <datasource name="ds" caption="Literal &#13;">
      <column name="[Profit]" datatype="real" role="measure" type="quantitative"/>
    </datasource>
  </datasources>
</workbook>`;

/** The scenarios exercised by field-resolver.test.ts, as (xml, query, options). */
const SCENARIOS: Array<[string, string, string, FieldResolveOptions]> = [
  ['cross-datasource ambiguity', WB_TWO_DATASOURCES, 'Profit', {}],
  ['scoped by internal name', WB_TWO_DATASOURCES, 'Profit', { datasource: 'ds1' }],
  ['exact column_ref', WB_TWO_DATASOURCES, '[ds2].[sum:Profit:qk]', {}],
  ['column_ref miss', WB_TWO_DATASOURCES, '[missing_ds].[sum:Profit:qk]', {}],
  [
    'unique caption selector',
    WB_TWO_DATASOURCES,
    'Profit',
    { datasource: 'Sample - Coffee Chain' },
  ],
  [
    'caption with provenance marker',
    WB_CAPTION_PROVENANCE,
    'Profit',
    { datasource: 'Literal &#13;' },
  ],
  [
    'non-unique caption selector',
    WB_DUPLICATE_DATASOURCE_CAPTIONS,
    'Profit',
    { datasource: 'Shared Caption' },
  ],
  ['empty query', WB_TWO_DATASOURCES, '', {}],
  ['near-miss fuzzy', WB_TWO_DATASOURCES, 'Profitt', { datasource: 'ds1' }],
  ['aggregation prefix', WB_TWO_DATASOURCES, 'sum of Profit', { datasource: 'ds1' }],
  ['bracket normalization', WB_TWO_DATASOURCES, '[Region]', { datasource: 'ds1' }],
  [
    'redundant aggregation on calc',
    WB_AGGREGATED_CALC,
    'sum of Profit Ratio',
    { datasource: 'ds1' },
  ],
  ['caption-exact wins', WB_CAPTION_EXACT, 'Country', {}],
  ['unsuffixed near-duplicate twin', WB_NEAR_DUPLICATES, 'Country', {}],
  ['near-duplicate through aggregation', WB_NEAR_DUPLICATES, 'sum of Goals For', {}],
];

function keyOutputs(r: FieldResolution): {
  kind: string;
  column_ref: string | undefined;
  datasource: string | undefined;
  candidateRefs: string[];
  notes: string[] | undefined;
  rewrites: string[] | undefined;
} {
  return {
    kind: r.kind,
    column_ref: r.column_ref,
    datasource: r.datasource,
    candidateRefs: (r.candidates ?? []).map((c) => c.column_ref).sort(),
    notes: r.notes,
    rewrites: r.rewrites,
  };
}

describe('resolveFieldViaDomain — parity with the legacy resolver', () => {
  for (const [name, xml, query, options] of SCENARIOS) {
    it(`matches legacy on: ${name}`, () => {
      const legacy = resolveField(xml, query, options);
      const domain = resolveFieldViaDomain(xml, query, options);
      expect(keyOutputs(domain)).toEqual(keyOutputs(legacy));
    });
  }
});

// A few explicit assertions so the contract is legible, not only differential.
describe('resolveFieldViaDomain — explicit outcomes', () => {
  it('flags cross-datasource ambiguity with both candidates', () => {
    const r = resolveFieldViaDomain(WB_TWO_DATASOURCES, 'Profit');
    expect(r.kind).toBe('ambiguous');
    expect(r.candidates?.length).toBe(2);
  });

  it('resolves a scoped bare name to a sum instance', () => {
    const r = resolveFieldViaDomain(WB_TWO_DATASOURCES, 'Profit', { datasource: 'ds1' });
    expect(r.kind).toBe('exact');
    expect(r.column_ref).toBe('[ds1].[sum:Profit:qk]');
    expect(r.datasource).toBe('ds1');
  });

  it('never re-aggregates an already-aggregated calc', () => {
    const r = resolveFieldViaDomain(WB_AGGREGATED_CALC, 'sum of Profit Ratio', {
      datasource: 'ds1',
    });
    expect(r.kind).toBe('rewritten');
    expect(r.column_ref).toBe('[ds1].[usr:Profit Ratio:qk]');
    expect(r.rewrites).toContain('ignored-redundant-aggregation');
  });

  it('picks the unsuffixed twin and notes the near-duplicate family', () => {
    const r = resolveFieldViaDomain(WB_NEAR_DUPLICATES, 'Country');
    expect(r.kind).toBe('exact');
    expect(r.column_ref).toBe('[football].[none:Country:nk]');
    expect(r.notes?.[0]).toContain('near-duplicate');
  });
});
