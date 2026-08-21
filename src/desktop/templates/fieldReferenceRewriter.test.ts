import { beforeAll, describe, expect, it } from 'vitest';

import {
  rewriteFieldReferences,
  rewriteFieldReferencesWithDiagnostics,
} from './fieldReferenceRewriter.js';
import { getRuntimeTemplateSnapshot } from './runtimeTemplateCatalog.js';
import type { TemplateRuntimeSnapshot } from './templateRuntimeSnapshot.js';

// Ports A's ref-class coverage (W10-E8) onto this repo's TBM-derived runtime snapshots.
// The shared DOM-structural rewriter must rewrite every reference CLASS a template
// carries — bare column declarations, base-column-attr rewrites, plain and
// COMPOUND (table-calc) column-instance names, datasource-qualified refs in text
// nodes and attributes, and calc formula/caption bodies — with zero field-ref
// residue, while leaving human labels and non-field bracket tokens intact.

function runtimeSnapshot(name: string): TemplateRuntimeSnapshot {
  const snapshot = getRuntimeTemplateSnapshot(name);
  if (!snapshot) throw new Error(`missing runtime template snapshot: ${name}`);
  return snapshot;
}

describe('rewriteFieldReferences — raw-vs-escaped boundary (named contract)', () => {
  // The rewriter takes RAW inputs and escapes EXCLUSIVELY via DOM serialization.
  // A metachar-bearing field name / datasource must be escaped EXACTLY ONCE.
  const xml =
    '<?xml version="1.0"?><worksheet><table><view>' +
    "<datasource-dependencies datasource='{{DATASOURCE}}'>" +
    "<column datatype='string' name='[Field]' role='dimension' type='nominal' />" +
    "<column-instance column='[Field]' derivation='None' name='[none:Field:nk]' pivot='key' type='nominal' />" +
    '</datasource-dependencies>' +
    '<rows>[{{DATASOURCE}}].[none:Field:nk]</rows>' +
    '</view></table></worksheet>';

  it('escapes a metachar-bearing RAW field name exactly once', () => {
    // Caller passes RAW values (NOT pre-escaped): `R&D <Team>` and `Acme & Co`.
    const out = rewriteFieldReferences(xml, { Field: '[DS].[none:R&D <Team>:nk]' }, 'Acme & Co');

    // Escaped once by serialization (`&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`).
    expect(out).toContain('[R&amp;D &lt;Team&gt;]'); // renamed base <column>
    expect(out).toContain('Acme &amp; Co'); // datasource fill
    // NOT double-escaped (would be the symptom of a pre-escaping caller).
    expect(out).not.toContain('&amp;amp;');
    expect(out).not.toContain('&amp;lt;');
    // NOT left raw/unescaped anywhere.
    expect(out).not.toContain('R&D <Team>');
    expect(out).not.toContain('[Field]');
  });

  it('parses a five-segment indexed table-calc instance without inventing a field name', () => {
    const out = rewriteFieldReferences(xml, { Field: '[DS].[pcto:sum:Sales:qk:3]' }, 'DS');

    expect(out).toContain('name="[Sales]"');
    expect(out).not.toContain('name="[qk]"');
  });

  it('rewrites an unqualified generated-instance source reference', () => {
    const forecastXml = xml.replace(
      "name='[none:Field:nk]'",
      "forecast-column-base='[sum:Field:qk]' name='[fVal:sum:Field:qk]'",
    );
    const out = rewriteFieldReferences(forecastXml, { Field: '[DS].[avg:Revenue:qk]' }, 'DS');

    expect(out).toContain('forecast-column-base="[avg:Revenue:qk]"');
    expect(out).not.toContain('forecast-column-base="[sum:Field:qk]"');
  });
});

describe('rewriteFieldReferences — donor number formats', () => {
  const xml =
    '<workbook><worksheets><worksheet><table><view>' +
    "<column datatype='real' name='[Profit]' role='measure' type='quantitative'/>" +
    "<column-instance column='[Profit]' derivation='Sum' name='[sum:Profit:qk]'/>" +
    '</view><style><style-rule element="label">' +
    '<format attr="text-format" field="[Donor].[sum:Profit:qk]" value="c&amp;quot;£&amp;quot;#,##0,K;-&amp;quot;£&amp;quot;#,##0,K"/>' +
    '<format attr="text-format" field="[Donor].[sum:Unmapped:qk]" value="n#,##0.00"/>' +
    '</style-rule></style><rows>[Donor].[sum:Profit:qk]</rows>' +
    '</table></worksheet></worksheets></workbook>';

  it('removes a donor currency override from a rewritten target field', () => {
    const out = rewriteFieldReferences(
      xml,
      { Profit: '[Superstore].[sum:Sales:qk]' },
      'Superstore',
    );

    expect(out).toContain('[Superstore].[sum:Sales:qk]');
    expect(out).not.toContain('£');
  });

  it('preserves an unrelated neutral numeric format', () => {
    const out = rewriteFieldReferences(
      xml,
      { Profit: '[Superstore].[sum:Sales:qk]' },
      'Superstore',
    );

    expect(out).toContain('value="n#,##0.00"');
  });

  it('does not alter donor formatting when no field is bound', () => {
    const out = rewriteFieldReferences(xml, {}, 'Superstore');

    expect(out).toContain('£');
  });
});

describe('rewriteFieldReferences — fallback and error behavior', () => {
  const concreteXml =
    '<workbook><worksheets><worksheet><table><view>' +
    "<column datatype='real' name='[Value]' role='measure' type='quantitative'/>" +
    "<column-instance column='[Value]' derivation='Sum' name='[sum:Value:qk]'/>" +
    '</view><rows>[{{DATASOURCE}}].[sum:Value:qk]</rows>' +
    '</table></worksheet></worksheets></workbook>';

  it('fills the datasource while leaving concrete fields unchanged for an empty mapping', () => {
    const out = rewriteFieldReferences(concreteXml, {}, 'Sales Data');

    expect(out).toContain('[Sales Data].[sum:Value:qk]');
    expect(out).toContain('[Value]');
    expect(out).not.toContain('{{DATASOURCE}}');
  });

  it('leaves concrete refs unchanged when the mapping names no authored field', () => {
    const out = rewriteFieldReferences(
      concreteXml,
      { Nonexistent: '[DS].[sum:Foo:qk]' },
      'Sales Data',
    );

    expect(out).toContain('[Sales Data].[sum:Value:qk]');
    expect(out).toContain('[Value]');
    expect(out).not.toContain('Foo');
  });

  it('skips a malformed mapping value without corrupting concrete refs', () => {
    const out = rewriteFieldReferences(concreteXml, { Value: 'garbage-no-brackets' }, 'Sales Data');

    expect(out).toContain('[Sales Data].[sum:Value:qk]');
    expect(out).toContain('[Value]');
  });

  it('throws on template XML with no root element', () => {
    expect(() => rewriteFieldReferences('', {}, 'X')).toThrow(/root element/);
  });

  it('returns serialized XML when the document contains no field refs', () => {
    const out = rewriteFieldReferences('<workbook><table/></workbook>', {}, 'X');

    expect(out).toContain('<workbook>');
  });
});

describe('rewriteFieldReferences — explicit base-name placeholders', () => {
  const slots = [
    {
      slot_id: 'category',
      template_field: '{{field_base_1}}',
      required: true,
      bindable: true,
      kind: 'categorical',
      role: ['rows'],
    },
    {
      slot_id: 'value',
      template_field: '{{field_base_2}}',
      required: true,
      bindable: true,
      kind: 'quantitative',
      role: ['cols'],
    },
  ];
  const xml =
    '<workbook><worksheets><worksheet><table><view>' +
    "<datasource-dependencies datasource='{{DATASOURCE}}'>" +
    "<column datatype='string' name='[{{field_base_1}}]' role='dimension' type='nominal' />" +
    "<column datatype='real' name='[{{field_base_2}}]' role='measure' type='quantitative' />" +
    "<column-instance column='[{{field_base_1}}]' derivation='None' name='[none:{{field_base_1}}:nk]' />" +
    "<column-instance column='[{{field_base_2}}]' derivation='Sum' name='[sum:{{field_base_2}}:qk]' />" +
    '</datasource-dependencies>' +
    "<computed-sort column='[{{DATASOURCE}}].[none:{{field_base_1}}:nk]' using='[{{DATASOURCE}}].[sum:{{field_base_2}}:qk]' />" +
    '</view><rows>[{{DATASOURCE}}].[none:{{field_base_1}}:nk]</rows>' +
    '<cols>[{{DATASOURCE}}].[sum:{{field_base_2}}:qk]</cols></table></worksheet></worksheets></workbook>';

  it('expands stable slot-id mapping keys through every reference class', () => {
    const out = rewriteFieldReferences(
      xml,
      {
        category: '[DS].[none:Segment:nk]',
        value: '[DS].[sum:Revenue:qk]',
      },
      'DS',
      undefined,
      { templateSlots: slots },
    );

    expect(out).toContain('column="[DS].[none:Segment:nk]"');
    expect(out).toContain('using="[DS].[sum:Revenue:qk]"');
    expect(out).toContain('<rows>[DS].[none:Segment:nk]</rows>');
    expect(out).toContain('<cols>[DS].[sum:Revenue:qk]</cols>');
    expect(out).not.toMatch(/\{\{field_base_\d+\}\}/);
  });

  it('fails loud when any field placeholder survives without manifest metadata', () => {
    expect(() => rewriteFieldReferences(xml, {}, 'DS')).toThrow(
      /unresolved template field placeholder/i,
    );
  });

  it('turns a placeholder-backed dateparse calc into an internal calc name', () => {
    const calcXml =
      '<workbook><worksheets><worksheet><table><view>' +
      "<datasource-dependencies datasource='{{DATASOURCE}}'>" +
      "<column datatype='date' name='[{{field_base_1}}]' role='dimension' type='ordinal'>" +
      "<calculation class='tableau' formula=\"DATEPARSE('yyyy-MM', [month])\" />" +
      '</column>' +
      "<column datatype='string' name='[month]' role='dimension' type='nominal' />" +
      "<column-instance column='[{{field_base_1}}]' derivation='Month-Trunc' name='[tmn:{{field_base_1}}:qk]' />" +
      '</datasource-dependencies></view>' +
      '<cols>[{{DATASOURCE}}].[tmn:{{field_base_1}}:qk]</cols>' +
      '</table></worksheet></worksheets></workbook>';

    const out = rewriteFieldReferences(calcXml, {}, 'DS', undefined, {
      namespaceCalcs: true,
      applyNonce: 'dateparse-placeholder',
      templateSlots: [slots[0]],
    });

    expect(out).toMatch(/Calculation_field_base_1_tpl_[0-9a-f]{8}/);
    expect(out).not.toContain('{{field_base_1}}');
  });

  it.each([
    ['bare', '{{field_base_1}}'],
    ['qualified', '{{field_base_1}}@sum'],
  ])(
    'honors a legal %s authored-slot derivation override without clobbering secondary derivations',
    (_mode, mappingKey) => {
      const overrideXml =
        '<workbook><worksheets><worksheet><table><view>' +
        "<column datatype='real' name='[{{field_base_1}}]' role='measure' type='quantitative'/>" +
        "<column-instance column='[{{field_base_1}}]' derivation='Sum' name='[sum:{{field_base_1}}:qk]'/>" +
        '</view><rows>[{{DATASOURCE}}].[sum:{{field_base_1}}:qk]</rows>' +
        '<cols>[{{DATASOURCE}}].[ctd:{{field_base_1}}:qk]</cols>' +
        '</table></worksheet></worksheets></workbook>';

      const out = rewriteFieldReferences(
        overrideXml,
        { [mappingKey]: '[DS].[avg:Revenue:qk]' },
        'DS',
        undefined,
        {
          templateSlots: [
            {
              slot_id: 'field_base_1',
              template_field: '{{field_base_1}}',
              derivation: 'sum',
              required: true,
              bindable: true,
            },
          ],
        },
      );

      expect(out).toContain('name="[avg:Revenue:qk]"');
      expect(out).toContain('<rows>[DS].[avg:Revenue:qk]</rows>');
      expect(out).toContain('<cols>[DS].[ctd:Revenue:qk]</cols>');
    },
  );

  it('rejects an authored slot derivation that has no primary instance in the template XML', () => {
    const mismatchXml =
      '<workbook><worksheets><worksheet><table><view>' +
      "<column datatype='real' name='[{{field_base_1}}]' role='measure' type='quantitative'/>" +
      "<column-instance column='[{{field_base_1}}]' derivation='Avg' name='[avg:{{field_base_1}}:qk]'/>" +
      '</view><rows>[{{DATASOURCE}}].[avg:{{field_base_1}}:qk]</rows>' +
      '</table></worksheet></worksheets></workbook>';

    expect(() =>
      rewriteFieldReferences(
        mismatchXml,
        { '{{field_base_1}}': '[DS].[max:Revenue:qk]' },
        'DS',
        undefined,
        {
          templateSlots: [
            {
              slot_id: 'field_base_1',
              template_field: '{{field_base_1}}',
              derivation: 'sum',
              required: true,
              bindable: true,
            },
          ],
        },
      ),
    ).toThrow(/descriptor.*sum.*no authored primary instance/i);
  });

  it('rejects concrete legacy descriptors that do not own positional field tokens', () => {
    const legacySlots = [
      {
        slot_id: 'measure',
        template_field: 'Profit',
        required: true,
        bindable: true,
        kind: 'quantitative',
        role: ['rows', 'sort-measure'],
      },
      {
        slot_id: 'category',
        template_field: 'Sub-Category',
        required: true,
        bindable: true,
        kind: 'categorical',
        role: ['cols', 'sort-dimension'],
      },
    ];
    const legacyXml =
      '<workbook><worksheets><worksheet><table><view>' +
      "<computed-sort column='[{{DATASOURCE}}].[none:{{field_base_2}}:nk]' " +
      "using='[{{DATASOURCE}}].[sum:{{field_base_1}}:qk]' />" +
      '</view></table></worksheet></worksheets></workbook>';

    expect(() =>
      rewriteFieldReferences(
        legacyXml,
        {
          Profit: '[DS].[sum:Margin:qk]',
          'Sub-Category': '[DS].[none:Product:nk]',
        },
        'DS',
        undefined,
        { templateSlots: legacySlots },
      ),
    ).toThrow(/Unresolved template field placeholder/);
  });

  it('does not use slot position to hide a mismatched optional descriptor', () => {
    const optionalSlots = [
      {
        slot_id: 'category',
        template_field: 'Category',
        required: true,
        bindable: true,
        kind: 'categorical',
        role: ['rows'],
      },
      {
        slot_id: 'sort_measure',
        template_field: 'Sort Measure',
        required: false,
        bindable: true,
        kind: 'quantitative',
        role: ['sort-measure'],
      },
    ];
    const optionalSortXml =
      '<workbook><worksheets><worksheet><table><view>' +
      "<column datatype='string' name='[Category]' role='dimension' type='nominal' />" +
      "<computed-sort column='[{{DATASOURCE}}].[none:{{field_base_1}}:nk]' " +
      "using='[{{DATASOURCE}}].[sum:{{field_base_2}}:qk]' />" +
      '</view><rows>[{{DATASOURCE}}].[none:Category:nk]</rows>' +
      '</table></worksheet></worksheets></workbook>';

    expect(() =>
      rewriteFieldReferencesWithDiagnostics(
        optionalSortXml,
        { Category: '[DS].[none:Product:nk]' },
        'DS',
        undefined,
        { templateSlots: optionalSlots },
      ),
    ).toThrow(/Unresolved template field placeholder/);
  });
});

describe('rewriteFieldReferences — ref-class coverage: kpi-text (aggregated measure)', () => {
  let snapshot: TemplateRuntimeSnapshot;
  const mapping = { '{{field_base_1}}': '[DS].[sum:Revenue:qk]' };
  const datasource = 'Sales Data';
  const run = (): string =>
    rewriteFieldReferences(snapshot.xml, mapping, datasource, undefined, {
      templateSlots: snapshot.descriptor.slots,
    });
  beforeAll(() => {
    snapshot = runtimeSnapshot('kpi-text');
  });

  it('rewrites the raw placeholder base <column> declaration to Revenue', () => {
    const r = run();
    expect(r).toMatch(/<column [^>]*name="\[Revenue\]"/);
    expect(r).not.toContain('{{field_base_1}}');
  });

  it('rewrites the aggregated instance name with a LOWERCASE short code + capitalized derivation attr', () => {
    const r = run();
    expect(r).toContain('name="[sum:Revenue:qk]"');
    expect(r).toContain('derivation="Sum"');
    expect(r).not.toContain('[Sum:Revenue:qk]'); // never capitalize the name itself
  });

  it('rewrites the datasource-qualified encoding ref and fills {{DATASOURCE}}', () => {
    const r = run();
    expect(r).toContain('column="[Sales Data].[sum:Revenue:qk]"');
    expect(r).not.toContain('{{DATASOURCE}}');
  });
});

describe('rewriteFieldReferences — ref-class coverage: ranking-ordered-bar (dimension + measure + computed-sort)', () => {
  let snapshot: TemplateRuntimeSnapshot;
  const mapping = {
    '{{field_base_1}}': '[DS].[none:Segment:nk]',
    '{{field_base_2}}': '[DS].[sum:Profit:qk]',
  };
  const datasource = 'Superstore';
  const run = (): string =>
    rewriteFieldReferences(snapshot.xml, mapping, datasource, undefined, {
      templateSlots: snapshot.descriptor.slots,
    });
  beforeAll(() => {
    snapshot = runtimeSnapshot('ranking-ordered-bar');
  });

  it('rewrites both bare base <column> declarations', () => {
    const r = run();
    expect(r).toMatch(/<column [^>]*name="\[Segment\]"/);
    expect(r).toMatch(/<column [^>]*name="\[Profit\]"/);
    expect(r).not.toMatch(/\{\{field_base_\d+\}\}/);
  });

  it('rewrites plain instance names with lowercase short codes (none/sum)', () => {
    const r = run();
    expect(r).toContain('name="[none:Segment:nk]"');
    expect(r).toContain('name="[sum:Profit:qk]"');
  });

  it('rewrites the <computed-sort> column= and using= refs (dimension + measure)', () => {
    const r = run();
    expect(r).toContain('column="[Superstore].[none:Segment:nk]"');
    expect(r).toContain('using="[Superstore].[sum:Profit:qk]"');
  });

  it('rewrites the rows/cols text-node refs with ZERO old field-ref residue', () => {
    const r = run();
    expect(r).toContain('<rows>[Superstore].[none:Segment:nk]</rows>');
    expect(r).toContain('<cols>[Superstore].[sum:Profit:qk]</cols>');
    expect(r).not.toContain('{{DATASOURCE}}');
    expect(r).not.toMatch(/\{\{field_base_\d+\}\}/);
  });
});

describe('rewriteFieldReferences — ref-class coverage: pareto-chart (compound derivation / Parameters / Measure Names)', () => {
  let snapshot: TemplateRuntimeSnapshot;
  const mapping = {
    '{{field_base_1}}': '[DS].[sum:Profit:qk]',
    '{{field_base_2}}': '[DS].[none:Segment:nk]',
  };
  const datasource = 'Superstore';
  const run = (): string =>
    rewriteFieldReferences(snapshot.xml, mapping, datasource, undefined, {
      templateSlots: snapshot.descriptor.slots,
    });
  beforeAll(() => {
    snapshot = runtimeSnapshot('pareto-chart');
  });

  it('remaps the COMPOUND (table-calc) derivation ref, preserving the pcto:cum wrapper', () => {
    const r = run();
    // instance name + every qualified occurrence
    expect(r).toContain('name="[pcto:cum:sum:Profit:qk]"');
    expect(r).toContain('[Superstore].[pcto:cum:sum:Profit:qk]');
    expect(r).not.toContain('[pcto:cum:sum:Sales:qk]');
  });

  it('remaps the simple aggregated ref alongside the compound one in the rows formula', () => {
    const r = run();
    expect(r).toContain('([Superstore].[sum:Profit:qk] + [Superstore].[pcto:cum:sum:Profit:qk])');
  });

  it('preserves the [:Measure Names] pseudo-field ref (fills datasource only)', () => {
    const r = run();
    expect(r).toContain('[Superstore].[:Measure Names]');
  });

  it('leaves the Parameters datasource and calc caption untouched when namespacing is off', () => {
    const r = run();
    expect(r).toContain('[Parameters].[Parameter 3]');
    expect(r).not.toContain('[Superstore].[Parameter 3]');
    expect(r).toContain('caption="80%"');
    expect(r).not.toMatch(/_tpl_/);
  });

  it('leaves ZERO mapped-field-ref residue', () => {
    const r = run();
    expect(r).not.toContain('{{DATASOURCE}}');
    expect(r).not.toMatch(/\{\{field_base_\d+\}\}/);
  });
});

describe('rewriteFieldReferences — ref-class coverage: part-to-whole-waterfall (W10-E8 port)', () => {
  let snapshot: TemplateRuntimeSnapshot;
  const DS = 'World Indicators';
  const mapping = {
    '{{field_base_1}}@sum': `[${DS}].[sum:population:qk]`,
    '{{field_base_2}}': `[${DS}].[none:country:nk]`,
    '{{field_base_1}}@none': `[${DS}].[none:population:qk]`,
  };
  const run = (): string =>
    rewriteFieldReferences(snapshot.xml, mapping, DS, undefined, {
      templateSlots: snapshot.descriptor.slots,
    });
  beforeAll(() => {
    snapshot = runtimeSnapshot('part-to-whole-waterfall');
  });

  it('class 1: rewrites the nominal encoding instance (none)', () => {
    const r = run();
    expect(r).toContain('name="[none:country:nk]"');
    expect(r).toContain(`[${DS}].[none:country:nk]`);
    expect(r).not.toContain('{{field_base_2}}');
  });

  it('class 2: rewrites the aggregated encoding instance (sum)', () => {
    const r = run();
    expect(r).toContain('name="[sum:population:qk]"');
    expect(r).toContain(`using="[${DS}].[sum:population:qk]"`);
    expect(r).toMatch(new RegExp(`<size column="\\[${DS}\\]\\.\\[sum:Calculation_[^\\]]+:qk\\]"`));
    expect(r).not.toContain('[sum:{{field_base_1}}:qk]');
  });

  it('class 3: rewrites the table-calc instance and preserves the cum wrapper', () => {
    const r = run();
    expect(r).toContain('name="[cum:sum:population:qk]"');
    expect(r).toContain(`<rows>[${DS}].[cum:sum:population:qk]</rows>`);
    expect(r).toContain(`field="[${DS}].[cum:sum:population:qk]"`);
    expect(r).not.toContain('[cum:sum:{{field_base_1}}:qk]');
  });

  it('class 4: rewrites both authored contribution calc formulas to population', () => {
    const r = run();
    expect(r).toContain('formula="-[population]"');
    expect(r).toContain('formula="SUM([population])&gt;0"');
    expect(r).not.toContain('{{field_base_1}}');
  });

  it('class 5/6: rewrites the bare category and measure placeholder declarations', () => {
    const r = run();
    expect(r).toMatch(/<column [^>]*name="\[country\]"/);
    expect(r).toMatch(/<column [^>]*name="\[population\]"/);
    expect(r).not.toMatch(/name="\[\{\{field_base_\d+\}\}\]"/);
  });

  it('leaves ZERO mapped-field-ref residue (human labels & unmapped calc CI untouched)', () => {
    const r = run();
    // No field-ref forms of the mapped fields survive.
    expect(r).not.toMatch(/\{\{field_base_\d+\}\}/);
    // The template-owned calc column instance is preserved.
    expect(r).toMatch(/Calculation_\d+/);
    expect(r).not.toContain('{{DATASOURCE}}');
  });
});

describe('rewriteFieldReferences — calc caption rewrite (synthetic; no shipped template carries a bracket caption)', () => {
  // A's "class 4" also covers a calc caption that MIRRORS its formula
  // (`-SUM([Profit])`). No template shipped in this repo currently carries a
  // bracket-bearing calc caption, so this proves the caption pass on a minimal
  // synthetic template.
  const xml =
    '<workbook><worksheets><worksheet><table><view>' +
    "<datasource-dependencies datasource='{{DATASOURCE}}'>" +
    "<column caption='-SUM([Profit])' datatype='real' name='[Calc1]' role='measure' type='quantitative'>" +
    "<calculation class='tableau' formula='-SUM([Profit])' />" +
    '</column>' +
    "<column datatype='real' name='[Profit]' role='measure' type='quantitative' />" +
    '</datasource-dependencies></view></table></worksheet></worksheets></workbook>';

  it('rewrites bare field refs in BOTH the calc formula and its bracket caption', () => {
    const r = rewriteFieldReferences(xml, { Profit: '[DS].[sum:Gains:qk]' }, 'DS');
    expect(r).toContain('formula="-SUM([Gains])"');
    expect(r).toContain('caption="-SUM([Gains])"');
    expect(r).not.toContain('[Profit]');
  });
});

describe('rewriteFieldReferences — calc caption derivation when formula inputs are remapped (Ben regression)', () => {
  // Live defect (Ben, 2026-07-09 test1.twbx): correlation-scatter calc kept its
  // human caption "Profit Ratio" after its formula was rebound to SUM([Profit])/
  // SUM([Discount]), creating a second, wrong "Profit Ratio" beside the real one.
  // Fix: derive an honest caption when the formula field refs change.
  const xml =
    '<workbook><worksheets><worksheet><table><view>' +
    "<datasource-dependencies datasource='{{DATASOURCE}}'>" +
    "<column caption='Profit Ratio' datatype='real' name='[CalcRatio]' role='measure' type='quantitative'>" +
    "<calculation class='tableau' formula='SUM([Profit])/SUM([Sales])' />" +
    '</column>' +
    "<column datatype='real' name='[Profit]' role='measure' type='quantitative' />" +
    "<column datatype='real' name='[Sales]' role='measure' type='quantitative' />" +
    "<column datatype='real' name='[Discount]' role='measure' type='quantitative' />" +
    '</datasource-dependencies></view></table></worksheet></worksheets></workbook>';

  it('derives an honest caption when the formula inputs are remapped (humanized formula)', () => {
    // Bind Profit→Profit (identity), Sales→Discount (different) — caption should update.
    const r = rewriteFieldReferences(
      xml,
      { Profit: '[DS].[sum:Profit:qk]', Sales: '[DS].[sum:Discount:qk]' },
      'DS',
    );
    expect(r).toContain('formula="SUM([Profit])/SUM([Discount])"');
    expect(r).toContain('caption="Profit / Discount"'); // humanized formula (strategy 2)
    expect(r).not.toContain('caption="Profit Ratio"'); // stale caption is gone
  });

  it('keeps the original caption when the formula is NOT remapped (identity bind)', () => {
    const r = rewriteFieldReferences(
      xml,
      { Profit: '[DS].[sum:Profit:qk]', Sales: '[DS].[sum:Sales:qk]' },
      'DS',
    );
    expect(r).toContain('caption="Profit Ratio"'); // unchanged
  });

  it('leaves bracket-bearing captions alone (already handled by step 3b-ii)', () => {
    const xmlBracket =
      '<workbook><worksheets><worksheet><table><view>' +
      "<datasource-dependencies datasource='{{DATASOURCE}}'>" +
      "<column caption='[Profit]/[Sales]' datatype='real' name='[CalcRatio]' role='measure' type='quantitative'>" +
      "<calculation class='tableau' formula='SUM([Profit])/SUM([Sales])' />" +
      '</column>' +
      "<column datatype='real' name='[Profit]' role='measure' type='quantitative' />" +
      "<column datatype='real' name='[Sales]' role='measure' type='quantitative' />" +
      '</datasource-dependencies></view></table></worksheet></worksheets></workbook>';
    const r = rewriteFieldReferences(
      xmlBracket,
      { Profit: '[DS].[sum:Gains:qk]', Sales: '[DS].[sum:Revenue:qk]' },
      'DS',
    );
    // Step 3b-ii handles bracket captions; step 3b (human caption) is skipped.
    expect(r).toContain('caption="[Gains]/[Revenue]"');
    expect(r).not.toContain('[Profit]');
  });
});

describe('rewriteFieldReferences — per-apply calc namespacing (opt-in, deterministic)', () => {
  // Deviation from A: namespacing defaults OFF and never mints its own nonce; the
  // caller must pass `applyNonce`. This keeps the core pure/deterministic.
  let snapshot: TemplateRuntimeSnapshot;
  const mapping = {
    '{{field_base_1}}@sum': '[DS].[sum:Amount:qk]',
    '{{field_base_2}}': '[DS].[none:Category:nk]',
    '{{field_base_1}}@none': '[DS].[none:Amount:qk]',
  };
  beforeAll(() => {
    snapshot = runtimeSnapshot('part-to-whole-waterfall');
  });

  it('is OFF by default — calc names are untouched', () => {
    const off = rewriteFieldReferences(snapshot.xml, mapping, 'DS', undefined, {
      templateSlots: snapshot.descriptor.slots,
    });
    expect(off).not.toMatch(/_tpl_/);
    expect(off).toMatch(/name="\[Calculation_\d+\]"/);
  });

  it('is deterministic in the (template, nonce) pair and collision-free across nonces', () => {
    const a1 = rewriteFieldReferences(snapshot.xml, mapping, 'DS', undefined, {
      namespaceCalcs: true,
      applyNonce: 'nonce-1',
      templateSlots: snapshot.descriptor.slots,
    });
    const a2 = rewriteFieldReferences(snapshot.xml, mapping, 'DS', undefined, {
      namespaceCalcs: true,
      applyNonce: 'nonce-1',
      templateSlots: snapshot.descriptor.slots,
    });
    const b = rewriteFieldReferences(snapshot.xml, mapping, 'DS', undefined, {
      namespaceCalcs: true,
      applyNonce: 'nonce-2',
      templateSlots: snapshot.descriptor.slots,
    });
    expect(a1).toMatch(/_tpl_[0-9a-f]{8}/);
    expect(a1).toBe(a2); // same nonce → identical output
    expect(a1).not.toBe(b); // different nonce → different suffix
  });

  it('namespaces calc refs by the role marker across wrappers and trailing metadata', () => {
    const xml =
      "<workbook><column name='[Calc]'><calculation formula='1'/></column>" +
      '<rows>[DS].[win:sum:Calc:qk:67]</rows>' +
      '<cols>[DS].[cum:usr:Calc:qk]</cols></workbook>';

    const out = rewriteFieldReferences(xml, {}, 'DS', undefined, {
      namespaceCalcs: true,
      applyNonce: 'role-anchored',
    });

    expect(out).toMatch(/\[DS\]\.\[win:sum:Calc_tpl_[0-9a-f]{8}:qk:67\]/);
    expect(out).toMatch(/\[DS\]\.\[cum:usr:Calc_tpl_[0-9a-f]{8}:qk\]/);
    expect(out).not.toContain(':Calc:');
  });

  it('stripping the per-apply suffix reproduces the non-namespaced output byte-for-byte', () => {
    const off = rewriteFieldReferences(snapshot.xml, mapping, 'DS', undefined, {
      templateSlots: snapshot.descriptor.slots,
    });
    const on = rewriteFieldReferences(snapshot.xml, mapping, 'DS', undefined, {
      namespaceCalcs: true,
      applyNonce: 'nonce-1',
      templateSlots: snapshot.descriptor.slots,
    });
    expect(on.replace(/_tpl_[0-9a-f]+/g, '')).toBe(off);
  });

  it('requires an explicit nonce — namespaceCalcs:true alone is a no-op (pure core mints none)', () => {
    const noNonce = rewriteFieldReferences(snapshot.xml, mapping, 'DS', undefined, {
      namespaceCalcs: true,
      templateSlots: snapshot.descriptor.slots,
    });
    expect(noNonce).not.toMatch(/_tpl_/);
  });
});

describe('rewriteFieldReferences — semantic-role reconciliation (empty-map regression)', () => {
  // Live defect, tbm-test.pptx: spatial-symbol-map's donor geo columns were renamed to
  // World Indicators string dimensions but KEPT the donor's semantic-role, so the sheet
  // asserted `[City].[Name]` on "Hours to do Tax" — a field that datasource never
  // geocodes. Rows/cols are the GENERATED Lat/Long those roles produce, so the map
  // rendered with ZERO marks while its size/color legends populated normally.
  const geoTemplate =
    '<?xml version="1.0"?><worksheet><table><view>' +
    "<datasource-dependencies datasource='{{DATASOURCE}}'>" +
    "<column datatype='string' name='[City]' role='dimension' semantic-role='[City].[Name]' type='nominal' />" +
    "<column-instance column='[City]' derivation='None' name='[none:City:nk]' pivot='key' type='nominal' />" +
    '</datasource-dependencies>' +
    '<rows>[{{DATASOURCE}}].[Latitude (generated)]</rows>' +
    '</view></table></worksheet>';

  it('DROPS the donor geo role when the bound field has none', () => {
    const out = rewriteFieldReferences(
      geoTemplate,
      { City: '[World Indicators].[none:Hours to do Tax:nk]' },
      'World Indicators',
      { City: { datatype: 'string', type: 'nominal' } },
    );
    expect(out).toContain('[Hours to do Tax]');
    expect(out).not.toContain('semantic-role');
  });

  it('REPLACES the donor geo role with the role the bound field actually carries', () => {
    const out = rewriteFieldReferences(
      geoTemplate,
      { City: '[World Indicators].[none:Country/Region:nk]' },
      'World Indicators',
      { City: { datatype: 'string', type: 'nominal', semanticRole: '[Country].[ISO3166_2]' } },
    );
    expect(out).toContain('semantic-role="[Country].[ISO3166_2]"');
    expect(out).not.toContain('[City].[Name]');
  });

  it('drops the donor role when no metadata is supplied at all (assert nothing, never the donor)', () => {
    const out = rewriteFieldReferences(
      geoTemplate,
      { City: '[World Indicators].[none:Business Tax Rate:nk]' },
      'World Indicators',
    );
    expect(out).toContain('[Business Tax Rate]');
    expect(out).not.toContain('semantic-role');
  });

  it('leaves an UNMAPPED geo column untouched — reconciliation is scoped to renames', () => {
    const out = rewriteFieldReferences(geoTemplate, {}, 'World Indicators');
    expect(out).toContain('semantic-role="[City].[Name]"');
  });

  it('finds metadata under a derivation-qualified key', () => {
    const out = rewriteFieldReferences(
      geoTemplate,
      { City: '[World Indicators].[none:Country/Region:nk]' },
      'World Indicators',
      { 'City@none': { datatype: 'string', type: 'nominal', semanticRole: '[State].[Name]' } },
    );
    expect(out).toContain('semantic-role="[State].[Name]"');
  });

  it('a semanticRole-only entry does not blank the template datatype/type', () => {
    const out = rewriteFieldReferences(
      geoTemplate,
      { City: '[World Indicators].[none:Country/Region:nk]' },
      'World Indicators',
      { City: { semanticRole: '[Country].[Name]' } },
    );
    expect(out).toContain('datatype="string"');
    expect(out).toContain('type="nominal"');
    expect(out).toContain('semantic-role="[Country].[Name]"');
  });
});

describe('rewriteFieldReferences — calc SOURCE-FIELD attribute (<calculation column=...>)', () => {
  // Shape taken verbatim from the probe's failing case B23815: a `[State_Group]`
  // categorical-bin (group) whose source field is named on `@column`, not in a
  // formula. §3b only rewrites `@formula`, so before this fix the donor name /
  // live token survived and the residue guard threw the whole inject.
  const groupXml = (sourceField: string): string =>
    '<?xml version="1.0"?><worksheet><table><view>' +
    "<datasource-dependencies datasource='{{DATASOURCE}}'>" +
    `<column datatype='string' name='[${sourceField}]' role='dimension' type='nominal' />` +
    // The group column carries its OWN name, independent of the source field — that
    // is what makes `@column` the only place the source field is referenced.
    "<column datatype='string' name='[Territory Group]' role='dimension' type='nominal'>" +
    `<calculation class='categorical-bin' column='[${sourceField}]' default='&quot;Texas&quot;'>` +
    "<bin value='&quot;West&quot;'><value>&quot;California&quot;</value></bin>" +
    '</calculation></column>' +
    '</datasource-dependencies>' +
    `<rows>[{{DATASOURCE}}].[none:${sourceField}:nk]</rows>` +
    '</view></table></worksheet>';

  it('rewrites the group source ref when the bound field is the group base', () => {
    const out = rewriteFieldReferences(groupXml('State'), { State: '[DS].[none:Region:nk]' }, 'DS');
    expect(out).toContain('column="[Region]"');
    // No donor spelling of the source field survives on the calc.
    expect(out).not.toContain("column='[State]'");
    expect(out).not.toContain('column="[State]"');
  });

  it('rewrites a live {{field_base_N}} token, the residue that threw the inject', () => {
    const out = rewriteFieldReferences(
      groupXml('{{field_base_1}}'),
      { '{{field_base_1}}': '[DS].[none:Category:nk]' },
      'DS',
    );
    expect(out).toContain('column="[Category]"');
    // The whole point: zero `{{...}}` residue reaches the emitted sheet.
    expect(out).not.toContain('{{field_base_1}}');
  });

  it('leaves the group source ref alone when that field was not remapped', () => {
    // Only `Sales` is bound; the group is over `State`, which keeps its own name.
    const out = rewriteFieldReferences(
      groupXml('State').replace('<rows>', '<cols>[{{DATASOURCE}}].[sum:Sales:qk]</cols><rows>'),
      { Sales: '[DS].[sum:Profit:qk]' },
      'DS',
    );
    expect(out).toContain('column="[State]"');
  });

  it('does NOT rewrite a <connection><calculations> column DECLARATION', () => {
    // 109 of the 146 corpus occurrences are this form: it DECLARES a column in the
    // donor connection's namespace rather than referencing a sheet field. A template
    // never injects a connection, so renaming it would rename a declaration nothing
    // points at. Pinned so the XPath can't be loosened to `//calculation` later.
    const xml =
      '<?xml version="1.0"?><worksheet><table><view>' +
      "<datasource-dependencies datasource='{{DATASOURCE}}'>" +
      "<connection class='hyper'><calculations>" +
      "<calculation column='[Region]' formula='1' />" +
      '</calculations></connection>' +
      "<column datatype='string' name='[Region]' role='dimension' type='nominal' />" +
      "<column-instance column='[Region]' derivation='None' name='[none:Region:nk]' pivot='key' type='nominal' />" +
      '</datasource-dependencies>' +
      '<rows>[{{DATASOURCE}}].[none:Region:nk]</rows>' +
      '</view></table></worksheet>';

    const out = rewriteFieldReferences(xml, { Region: '[DS].[none:Segment:nk]' }, 'DS');
    // The sheet-level refs ARE rewritten…
    expect(out).toContain('[DS].[none:Segment:nk]');
    expect(out).toContain('name="[Segment]"');
    // …while the connection-level declaration keeps its own name.
    expect(out).toContain(
      '<calculations><calculation column="[Region]" formula="1"/></calculations>',
    );
  });
});

describe('rewriteFieldReferences — synthesize undeclared encoding-shelf instances (task #30)', () => {
  // A symbol-map bookmark declares <column-instance> nodes for its rows/cols/lod
  // pills but places aggregations directly on the mark ENCODINGS (color/size) that
  // it never declares. The External-API apply path validates dependencies, cannot
  // resolve the undeclared instance, and rejects the sheet with a blocking modal.
  // The rewriter must complete the declaration so the injected sheet is self-consistent.
  const symbolMap =
    "<worksheet name='m'><table><view>" +
    "<datasource-dependencies datasource='{{DATASOURCE}}'>" +
    "<column datatype='real' name='[Sales]' role='measure' type='quantitative' />" +
    "<column datatype='real' name='[Quantity]' role='measure' type='quantitative' />" +
    "<column datatype='string' name='[Category]' role='dimension' type='nominal' />" +
    "<column-instance column='[Category]' derivation='None' name='[none:Category:nk]' pivot='key' type='nominal' />" +
    '</datasource-dependencies>' +
    '<panes><pane><encodings>' +
    "<size column='[{{DATASOURCE}}].[sum:Sales:qk]' />" +
    "<color column='[{{DATASOURCE}}].[sum:Quantity:qk]' />" +
    "<lod column='[{{DATASOURCE}}].[none:Category:nk]' />" +
    '</encodings></pane></panes>' +
    '</view></table></worksheet>';

  it('synthesizes a declaration for each referenced-but-undeclared instance', () => {
    const out = rewriteFieldReferences(symbolMap, {}, 'Sample - Superstore');
    expect(out).toContain(
      '<column-instance column="[Sales]" derivation="Sum" name="[sum:Sales:qk]" pivot="key" type="quantitative"/>',
    );
    expect(out).toContain(
      '<column-instance column="[Quantity]" derivation="Sum" name="[sum:Quantity:qk]" pivot="key" type="quantitative"/>',
    );
  });

  it('does not duplicate an instance that is already declared', () => {
    const out = rewriteFieldReferences(symbolMap, {}, 'Sample - Superstore');
    const matches = out.match(/name="\[none:Category:nk\]"/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('does not fabricate a declaration when the base column is absent from the block', () => {
    const noColumn =
      "<worksheet name='m'><table><view>" +
      "<datasource-dependencies datasource='{{DATASOURCE}}'>" +
      "<column datatype='real' name='[Sales]' role='measure' type='quantitative' />" +
      '</datasource-dependencies>' +
      '<panes><pane><encodings>' +
      "<color column='[{{DATASOURCE}}].[sum:Latitude (generated):qk]' />" +
      '</encodings></pane></panes>' +
      '</view></table></worksheet>';
    const out = rewriteFieldReferences(noColumn, {}, 'DS');
    expect(out).not.toContain('name="[sum:Latitude (generated):qk]"');
  });

  it('carries the synthesized instance through a rename, matching the renamed base column', () => {
    // color references [sum:Quantity:qk]; Quantity is remapped to Profit → the
    // synthesized declaration must name the RENAMED base column, not the donor's.
    const out = rewriteFieldReferences(
      symbolMap,
      { Quantity: '[DS].[sum:Profit:qk]' },
      'Sample - Superstore',
    );
    expect(out).toContain(
      '<column-instance column="[Profit]" derivation="Sum" name="[sum:Profit:qk]" pivot="key" type="quantitative"/>',
    );
    expect(out).not.toContain('name="[sum:Quantity:qk]"');
  });
});
