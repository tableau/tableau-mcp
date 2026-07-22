import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

import { rewriteFieldReferences } from './fieldReferenceRewriter.js';

// Ports A's ref-class coverage (W10-E8) onto THIS repo's real shipped templates.
// The shared DOM-structural rewriter must rewrite every reference CLASS a template
// carries — bare column declarations, base-column-attr rewrites, plain and
// COMPOUND (table-calc) column-instance names, datasource-qualified refs in text
// nodes and attributes, and calc formula/caption bodies — with zero field-ref
// residue, while leaving human labels and non-field bracket tokens intact.

const TEMPLATES_DIR = join(process.cwd(), 'src', 'desktop', 'data', 'templates');

function readTemplate(name: string): string {
  return readFileSync(join(TEMPLATES_DIR, `${name}.xml`), 'utf-8');
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
});

describe('rewriteFieldReferences — ref-class coverage: kpi-text (aggregated measure)', () => {
  let kpiText: string;
  const mapping = { Value: '[DS].[sum:Revenue:qk]' };
  const datasource = 'Sales Data';
  beforeAll(() => {
    kpiText = readTemplate('kpi-text');
  });

  it('rewrites the bare base <column> declaration (Value→Revenue)', () => {
    const r = rewriteFieldReferences(kpiText, mapping, datasource);
    expect(r).toMatch(/<column [^>]*name="\[Revenue\]"/);
    expect(r).not.toContain('name="[Value]"');
  });

  it('rewrites the aggregated instance name with a LOWERCASE short code + capitalized derivation attr', () => {
    const r = rewriteFieldReferences(kpiText, mapping, datasource);
    expect(r).toContain('name="[sum:Revenue:qk]"');
    expect(r).toContain('derivation="Sum"');
    expect(r).not.toContain('[Sum:Revenue:qk]'); // never capitalize the name itself
    expect(r).not.toContain(':Value:');
  });

  it('rewrites the datasource-qualified encoding ref and fills {{DATASOURCE}}', () => {
    const r = rewriteFieldReferences(kpiText, mapping, datasource);
    expect(r).toContain('column="[Sales Data].[sum:Revenue:qk]"');
    expect(r).not.toContain('{{DATASOURCE}}');
  });
});

describe('rewriteFieldReferences — ref-class coverage: ranking-ordered-bar (dimension + measure + computed-sort)', () => {
  let ranking: string;
  const mapping = {
    '{{field_base_1}}': '[DS].[none:Segment:nk]',
    '{{field_base_2}}': '[DS].[sum:Profit:qk]',
    '{{field_base_3}}': '[DS].[none:Group:nk]',
  };
  const datasource = 'Superstore';
  beforeAll(() => {
    ranking = readTemplate('ranking-ordered-bar');
  });

  it('rewrites both bare base <column> declarations', () => {
    const r = rewriteFieldReferences(ranking, mapping, datasource);
    expect(r).toMatch(/<column [^>]*name="\[Segment\]"/);
    expect(r).toMatch(/<column [^>]*name="\[Profit\]"/);
    expect(r).not.toContain('name="[Category]"');
    expect(r).not.toContain('name="[Measure]"');
  });

  it('rewrites plain instance names with lowercase short codes (none/sum)', () => {
    const r = rewriteFieldReferences(ranking, mapping, datasource);
    expect(r).toContain('name="[none:Segment:nk]"');
    expect(r).toContain('name="[sum:Profit:qk]"');
  });

  it('rewrites the <computed-sort> column= and using= refs (dimension + measure)', () => {
    const r = rewriteFieldReferences(ranking, mapping, datasource);
    expect(r).toContain('column="[Superstore].[none:Segment:nk]"');
    expect(r).toContain('using="[Superstore].[sum:Profit:qk]"');
  });

  it('rewrites the rows/cols text-node refs with ZERO old field-ref residue', () => {
    const r = rewriteFieldReferences(ranking, mapping, datasource);
    expect(r).toContain('<rows>[Superstore].[none:Segment:nk]</rows>');
    expect(r).toContain('<cols>[Superstore].[sum:Profit:qk]</cols>');
    expect(r).not.toContain('{{DATASOURCE}}');
    expect(r).not.toMatch(/:Category:|:Measure:/);
  });
});

describe('rewriteFieldReferences — ref-class coverage: pareto-chart (compound derivation / Parameters / Measure Names)', () => {
  let pareto: string;
  const mapping = {
    Sales: '[DS].[sum:Profit:qk]',
    'Sub-Category': '[DS].[none:Segment:nk]',
  };
  const datasource = 'Superstore';
  beforeAll(() => {
    pareto = readTemplate('pareto-chart');
  });

  it('remaps the COMPOUND (table-calc) derivation ref, preserving the pcto:cum wrapper', () => {
    const r = rewriteFieldReferences(pareto, mapping, datasource);
    // instance name + every qualified occurrence
    expect(r).toContain('name="[pcto:cum:sum:Profit:qk]"');
    expect(r).toContain('[Superstore].[pcto:cum:sum:Profit:qk]');
    expect(r).not.toContain('[pcto:cum:sum:Sales:qk]');
  });

  it('remaps the simple aggregated ref alongside the compound one in the rows formula', () => {
    const r = rewriteFieldReferences(pareto, mapping, datasource);
    expect(r).toContain('([Superstore].[sum:Profit:qk] + [Superstore].[pcto:cum:sum:Profit:qk])');
  });

  it('preserves the [:Measure Names] pseudo-field ref (fills datasource only)', () => {
    const r = rewriteFieldReferences(pareto, mapping, datasource);
    expect(r).toContain('[Superstore].[:Measure Names]');
  });

  it('leaves the Parameters datasource + calc caption untouched (namespacing off by default)', () => {
    const r = rewriteFieldReferences(pareto, mapping, datasource);
    expect(r).toContain('[Parameters].[Parameter 3]');
    expect(r).toContain('caption="80%"');
    expect(r).not.toMatch(/_tpl_/);
  });

  it('leaves ZERO mapped-field-ref residue', () => {
    const r = rewriteFieldReferences(pareto, mapping, datasource);
    expect(r).not.toContain('{{DATASOURCE}}');
    expect(r).not.toMatch(/:Sales:|:Sub-Category:|\[Sub-Category\]|\[Sales\]/);
  });
});

describe('rewriteFieldReferences — ref-class coverage: part-to-whole-waterfall-chart (W10-E8 port)', () => {
  // Direct port of A's waterfall W10-E8 proof, run against THIS repo's real
  // template with the same {Sub-Category→country, Profit→population} remap.
  let waterfall: string;
  const DS = 'World Indicators';
  const mapping = {
    'Sub-Category': `[${DS}].[none:country:nk]`,
    Profit: `[${DS}].[sum:population:qk]`,
  };
  const run = (): string => rewriteFieldReferences(waterfall, mapping, DS);
  beforeAll(() => {
    waterfall = readTemplate('part-to-whole-waterfall-chart');
  });

  it('class 1: rewrites the nominal encoding instance (none)', () => {
    const r = run();
    expect(r).toContain('name="[none:country:nk]"');
    expect(r).toContain(`[${DS}].[none:country:nk]`);
    expect(r).not.toContain('[none:Sub-Category:nk]');
  });

  it('class 2: rewrites the aggregated encoding instance (sum)', () => {
    const r = run();
    expect(r).toContain('name="[sum:population:qk]"');
    expect(r).toContain(`<color column="[${DS}].[sum:population:qk]"`);
    expect(r).not.toContain('[sum:Profit:qk]');
  });

  it('class 3: rewrites the table-calc instance and preserves the cum wrapper', () => {
    const r = run();
    expect(r).toContain('name="[cum:sum:population:qk]"');
    expect(r).toContain(`<rows total="true">[${DS}].[cum:sum:population:qk]</rows>`);
    expect(r).toContain(`field="[${DS}].[cum:sum:population:qk]"`);
    expect(r).not.toContain('[cum:sum:Profit:qk]');
  });

  it('class 4: rewrites the calc FORMULA field ref (-[Profit] → -[population])', () => {
    const r = run();
    expect(r).toContain('formula="-[population]"');
    expect(r).not.toContain('formula="-[Profit]"');
  });

  it('class 5/6: rewrites the bare Sub-Category and Profit column declarations', () => {
    const r = run();
    expect(r).toMatch(/<column [^>]*name="\[country\]"/);
    expect(r).toMatch(/<column [^>]*name="\[population\]"/);
    expect(r).not.toContain('name="[Sub-Category]"');
    expect(r).not.toContain('name="[Profit]"');
  });

  it('leaves ZERO mapped-field-ref residue (human labels & unmapped calc CI untouched)', () => {
    const r = run();
    // No field-ref forms of the mapped fields survive.
    expect(r).not.toMatch(/:Sub-Category:|:Profit:|\[Profit\]|\[Sub-Category\]/);
    // The unmapped calc column instance is preserved verbatim.
    expect(r).toContain('Calculation_84161057772498944');
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
  let waterfall: string;
  beforeAll(() => {
    waterfall = readTemplate('part-to-whole-waterfall-chart');
  });

  it('is OFF by default — calc names are untouched', () => {
    const off = rewriteFieldReferences(waterfall, {}, 'DS');
    expect(off).not.toMatch(/_tpl_/);
    expect(off).toContain('name="[Calculation_84161057772498944]"');
  });

  it('is deterministic in the (template, nonce) pair and collision-free across nonces', () => {
    const a1 = rewriteFieldReferences(waterfall, {}, 'DS', undefined, {
      namespaceCalcs: true,
      applyNonce: 'nonce-1',
    });
    const a2 = rewriteFieldReferences(waterfall, {}, 'DS', undefined, {
      namespaceCalcs: true,
      applyNonce: 'nonce-1',
    });
    const b = rewriteFieldReferences(waterfall, {}, 'DS', undefined, {
      namespaceCalcs: true,
      applyNonce: 'nonce-2',
    });
    expect(a1).toMatch(/_tpl_[0-9a-f]{8}/);
    expect(a1).toBe(a2); // same nonce → identical output
    expect(a1).not.toBe(b); // different nonce → different suffix
  });

  it('stripping the per-apply suffix reproduces the non-namespaced output byte-for-byte', () => {
    const off = rewriteFieldReferences(waterfall, {}, 'DS');
    const on = rewriteFieldReferences(waterfall, {}, 'DS', undefined, {
      namespaceCalcs: true,
      applyNonce: 'nonce-1',
    });
    expect(on.replace(/_tpl_[0-9a-f]+/g, '')).toBe(off);
  });

  it('requires an explicit nonce — namespaceCalcs:true alone is a no-op (pure core mints none)', () => {
    const noNonce = rewriteFieldReferences(waterfall, {}, 'DS', undefined, {
      namespaceCalcs: true,
    });
    expect(noNonce).not.toMatch(/_tpl_/);
  });
});
