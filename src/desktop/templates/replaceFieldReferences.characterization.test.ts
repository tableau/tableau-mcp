import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

import { replaceFieldReferences } from './replaceFieldReferences.js';

// CHARACTERIZATION SUITE
// ----------------------
// These tests pin the CURRENT externally-observable behavior of the older
// direct rewriter ("C", src/desktop/templates/replaceFieldReferences.ts) against
// REAL template XML shipped in src/desktop/data/templates/. They exist so that
// when C is replaced by the shared DOM-structural rewriter, the diff reads as
// "what changed and why it's correct" rather than "hope nothing broke".
//
// Assertions are targeted, serialization-agnostic invariants (ref strings, not
// attribute quoting/ordering) — @xmldom/xmldom re-quotes and may reorder, so we
// pin the semantics of the rewrite, not the serializer's byte formatting.
//
// Tests tagged `// CHARACTERIZATION:` document current (NOT desired) behavior and
// are expected to be the reviewable diffs when the shared rewriter lands.

const TEMPLATES_DIR = join(process.cwd(), 'src', 'desktop', 'data', 'templates');

function readTemplate(name: string): string {
  return readFileSync(join(TEMPLATES_DIR, `${name}.xml`), 'utf-8');
}

let kpiText: string;
let rankingOrderedBar: string;
let pareto: string;

beforeAll(() => {
  // Representative picks:
  //  - kpi-text: single aggregated measure (Sum), simplest surface.
  //  - ranking-ordered-bar: aggregated measure + dimension + <computed-sort>.
  //  - pareto-chart: compound derivation ([pcto:cum:sum:...]), Parameters
  //    datasource, calc caption, and [:Measure Names] — exercises known-weak paths.
  kpiText = readTemplate('kpi-text');
  rankingOrderedBar = readTemplate('ranking-ordered-bar');
  pareto = readTemplate('pareto-chart');
});

describe('replaceFieldReferences — kpi-text (aggregated measure)', () => {
  const mapping = { Value: '[DS].[sum:Revenue:qk]' };
  const datasource = 'Sales Data';

  it('renames the base <column> to the mapped field name', () => {
    const out = replaceFieldReferences(kpiText, mapping, datasource);
    expect(out).toContain('[Revenue]');
    expect(out).not.toContain('[Value]');
  });

  it('rewrites the aggregated instance ref, filling {{DATASOURCE}} and the field', () => {
    const out = replaceFieldReferences(kpiText, mapping, datasource);
    expect(out).toContain('[Sales Data].[Sum:Revenue:qk]');
    expect(out).not.toContain('{{DATASOURCE}}');
    expect(out).not.toContain('sum:Value');
  });

  it('CHARACTERIZATION: capitalizes the derivation in the column-instance name (Sum, not sum)', () => {
    // CHARACTERIZATION: current behavior — the column-instance `name` attribute is
    // rebuilt from the friendly DERIVATION_MAP value, so `[sum:Value:qk]` becomes
    // `[Sum:Revenue:qk]`. Real Tableau instance names use the lowercase short code
    // (`[sum:Revenue:qk]`) while only the separate `derivation="Sum"` attribute is
    // capitalized. A correct rewriter should preserve the lowercase short code.
    const out = replaceFieldReferences(kpiText, mapping, datasource);
    expect(out).toContain('[Sum:Revenue:qk]');
    expect(out).not.toContain('[sum:Revenue:qk]');
  });
});

describe('replaceFieldReferences — ranking-ordered-bar (computed sort)', () => {
  const mapping = {
    Region: '[DS].[none:Category:nk]',
    Sales: '[DS].[sum:Profit:qk]',
  };
  const datasource = 'Superstore';

  it('renames both base <column>s to the mapped field names', () => {
    const out = replaceFieldReferences(rankingOrderedBar, mapping, datasource);
    expect(out).toContain('[Category]');
    expect(out).toContain('[Profit]');
    expect(out).not.toContain('[Region]');
    expect(out).not.toContain('[Sales]');
  });

  it('rewrites the <computed-sort> column= and using= refs (dimension + measure)', () => {
    const out = replaceFieldReferences(rankingOrderedBar, mapping, datasource);
    // computed-sort column='[{{DATASOURCE}}].[none:Region:nk]'
    expect(out).toContain('[Superstore].[None:Category:nk]');
    // computed-sort using='[{{DATASOURCE}}].[sum:Sales:qk]'
    expect(out).toContain('[Superstore].[Sum:Profit:qk]');
  });

  it('rewrites the rows/cols text-node refs and leaves no {{DATASOURCE}} or old field tokens', () => {
    const out = replaceFieldReferences(rankingOrderedBar, mapping, datasource);
    expect(out).not.toContain('{{DATASOURCE}}');
    expect(out).not.toContain(':Region:');
    expect(out).not.toContain(':Sales:');
  });

  it('CHARACTERIZATION: capitalizes the derivation for the dimension instance too (None, not none)', () => {
    // CHARACTERIZATION: same capitalization behavior as kpi-text — `[none:Region:nk]`
    // becomes `[None:Category:nk]` in every rewritten ref.
    const out = replaceFieldReferences(rankingOrderedBar, mapping, datasource);
    expect(out).toContain('[None:Category:nk]');
    expect(out).not.toContain('[none:Category:nk]');
  });
});

describe('replaceFieldReferences — pareto-chart (compound derivation / Parameters / calc)', () => {
  const mapping = {
    Sales: '[DS].[sum:Profit:qk]',
    'Sub-Category': '[DS].[none:Segment:nk]',
  };
  const datasource = 'Superstore';

  it('rewrites the simple aggregated ref', () => {
    const out = replaceFieldReferences(pareto, mapping, datasource);
    expect(out).toContain('[Superstore].[Sum:Profit:qk]');
    expect(out).not.toContain('{{DATASOURCE}}');
    expect(out).not.toContain('Sub-Category');
  });

  it('CHARACTERIZATION: does NOT remap the field inside a compound-derivation ref', () => {
    // CHARACTERIZATION: current behavior — `[{{DATASOURCE}}].[pcto:cum:sum:Sales:qk]`
    // only gets {{DATASOURCE}} filled; the field name `Sales` is NOT remapped to
    // `Profit` and the derivation is NOT normalized, because C's regex only matches
    // a single-segment derivation (`[<one>:<field>:<role>]`). The nested table-calc
    // ref survives untouched alongside the correctly-rewritten simple ref.
    const out = replaceFieldReferences(pareto, mapping, datasource);
    expect(out).toContain('[Superstore].[pcto:cum:sum:Sales:qk]');
    // Side-by-side proof in the <rows> formula: simple ref remapped, compound ref not.
    expect(out).toContain('([Superstore].[Sum:Profit:qk] + [Superstore].[pcto:cum:sum:Sales:qk])');
  });

  it('CHARACTERIZATION: leaves the column-instance name of the compound ref unchanged', () => {
    // CHARACTERIZATION: the `<column-instance name='[pcto:cum:sum:Sales:qk]'>` is not
    // rewritten (its field segment is misparsed by the single-segment regex), so the
    // instance name still reads `Sales`, not `Profit`.
    const out = replaceFieldReferences(pareto, mapping, datasource);
    expect(out).toContain('[pcto:cum:sum:Sales:qk]');
  });

  it('CHARACTERIZATION: does not rewrite the [:Measure Names] pseudo-field ref (only fills datasource)', () => {
    // CHARACTERIZATION: `[{{DATASOURCE}}].[:Measure Names]` has no derivation/field
    // segments to map, so only {{DATASOURCE}} is substituted.
    const out = replaceFieldReferences(pareto, mapping, datasource);
    expect(out).toContain('[Superstore].[:Measure Names]');
  });

  it('CHARACTERIZATION: leaves the Parameters datasource and its calc caption untouched', () => {
    // CHARACTERIZATION: no calc-caption rewrite — the parameter column caption ('80%')
    // and the literal `[Parameters].[Parameter 3]` refs / `Parameters` datasource name
    // are left exactly as authored.
    const out = replaceFieldReferences(pareto, mapping, datasource);
    expect(out).toContain('[Parameters].[Parameter 3]');
    // Serializer re-quotes attributes to double quotes; the caption VALUE ('80%')
    // is what we pin — it is passed through untouched.
    expect(out).toContain('caption="80%"');
    expect(out).toContain('formula');
  });
});

describe('replaceFieldReferences — fallback / error behavior', () => {
  it('empty mapping fills {{DATASOURCE}} but rewrites no field refs', () => {
    const out = replaceFieldReferences(kpiText, {}, 'Sales Data');
    // Datasource filled...
    expect(out).toContain('[Sales Data].[sum:Value:qk]');
    // ...but the field ref is left verbatim (derivation short code preserved).
    expect(out).toContain('[Value]');
    expect(out).not.toContain('{{DATASOURCE}}');
  });

  it('unmapped field (mapping targets a field the template does not contain) leaves refs alone', () => {
    const out = replaceFieldReferences(kpiText, { Nonexistent: '[DS].[sum:Foo:qk]' }, 'Sales Data');
    expect(out).toContain('[Sales Data].[sum:Value:qk]');
    expect(out).toContain('[Value]');
    expect(out).not.toContain('Foo');
  });

  it('CHARACTERIZATION: silently skips a mapping entry whose column-instance value is malformed', () => {
    // CHARACTERIZATION: buildFieldInfoMap `continue`s past values that do not match
    // `[<deriv>:<field>:<role>]`, so a garbage mapping value is a no-op (no throw),
    // and the template ref is left with only {{DATASOURCE}} filled.
    const out = replaceFieldReferences(kpiText, { Value: 'garbage-no-brackets' }, 'Sales Data');
    expect(out).toContain('[Sales Data].[sum:Value:qk]');
    expect(out).toContain('[Value]');
  });

  it('CHARACTERIZATION: throws (not a typed Result) on template XML with no root element', () => {
    // CHARACTERIZATION: current behavior — C is NOT defensive. The silent
    // DOMParser errorHandler swallows warnings, but a document with no root element
    // still raises a raw `ParseError: missing root element`. Consumers absorb this
    // differently: inject-template wraps the call in try/catch (→ FileReadError),
    // build-and-apply does not (the throw propagates to logAndExecute). A shared
    // rewriter that returns gracefully — or throws a typed error — would change this.
    expect(() => replaceFieldReferences('', {}, 'X')).toThrow(/root element/);
  });

  it('returns a string for well-formed XML that contains no mappable refs', () => {
    const out = replaceFieldReferences('<workbook><table/></workbook>', {}, 'X');
    expect(typeof out).toBe('string');
    expect(out).toContain('<workbook>');
  });
});
