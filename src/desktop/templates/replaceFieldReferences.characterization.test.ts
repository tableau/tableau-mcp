import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

import { rewriteFieldReferences } from './fieldReferenceRewriter.js';

// CHARACTERIZATION SUITE
// ----------------------
// Originally pinned the older direct rewriter ("C", the removed
// src/desktop/templates/replaceFieldReferences.ts wrapper) against REAL template XML
// shipped in src/desktop/data/templates/. W14-CM1 deleted that wrapper (a pure
// passthrough) and moved both consumers onto the shared core; this suite is retargeted
// onto the core (`rewriteFieldReferences`) VERBATIM to keep its coverage — notably the
// fallback / error-path invariants (empty mapping, unmapped/malformed mapping values,
// no-root-element throw, well-formed-no-refs) that the core's own colocated suite does
// not otherwise pin.
//
// Assertions are targeted, serialization-agnostic invariants (ref strings, not
// attribute quoting/ordering) — @xmldom/xmldom re-quotes and may reorder, so we
// pin the semantics of the rewrite, not the serializer's byte formatting.
//
// Tests tagged `// CHARACTERIZATION:` document behavior that is UNCHANGED by the
// shared DOM-structural rewriter. Pins whose behavior intentionally IMPROVED when
// the shared rewriter (`fieldReferenceRewriter.ts`) landed are re-tagged
// `// CONVERGENCE:` with a one-line note naming the improvement — those flips are
// the review artifact for this change.

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

describe('rewriteFieldReferences — kpi-text (aggregated measure)', () => {
  const mapping = { Value: '[DS].[sum:Revenue:qk]' };
  const datasource = 'Sales Data';

  it('renames the base <column> to the mapped field name', () => {
    const out = rewriteFieldReferences(kpiText, mapping, datasource);
    expect(out).toContain('[Revenue]');
    expect(out).not.toContain('[Value]');
  });

  it('rewrites the aggregated instance ref, filling {{DATASOURCE}} and the field', () => {
    // CONVERGENCE: the qualified ref now carries the lowercase short code
    // (`[sum:Revenue:qk]`), not the old capitalized `[Sum:Revenue:qk]`.
    const out = rewriteFieldReferences(kpiText, mapping, datasource);
    expect(out).toContain('[Sales Data].[sum:Revenue:qk]');
    expect(out).not.toContain('{{DATASOURCE}}');
    expect(out).not.toContain('sum:Value');
  });

  it('CONVERGENCE: keeps the lowercase short code in the column-instance name (sum, not Sum)', () => {
    // CONVERGENCE: the shared rewriter writes the lowercase short code into the
    // instance `name` (`[sum:Revenue:qk]`) and capitalizes only the separate
    // `derivation="Sum"` attribute — the live-Desktop-correct form. The old
    // rewriter capitalized the name itself (`[Sum:Revenue:qk]`), which fails to
    // bind (red pills / blank viz); that regression is now fixed.
    const out = rewriteFieldReferences(kpiText, mapping, datasource);
    expect(out).toContain('[sum:Revenue:qk]');
    expect(out).not.toContain('[Sum:Revenue:qk]');
  });
});

describe('rewriteFieldReferences — ranking-ordered-bar (computed sort)', () => {
  const mapping = {
    Category: '[DS].[none:Segment:nk]',
    Measure: '[DS].[sum:Profit:qk]',
  };
  const datasource = 'Superstore';

  it('renames both base <column>s to the mapped field names', () => {
    const out = rewriteFieldReferences(rankingOrderedBar, mapping, datasource);
    expect(out).toContain('[Segment]');
    expect(out).toContain('[Profit]');
    expect(out).not.toContain('[Category]');
    expect(out).not.toContain('[Measure]');
  });

  it('rewrites the <computed-sort> column= and using= refs (dimension + measure)', () => {
    const out = rewriteFieldReferences(rankingOrderedBar, mapping, datasource);
    // CONVERGENCE: refs now carry the lowercase short code (none/sum), not the old
    // capitalized None/Sum.
    // computed-sort column='[{{DATASOURCE}}].[none:Category:nk]'
    expect(out).toContain('[Superstore].[none:Segment:nk]');
    // computed-sort using='[{{DATASOURCE}}].[sum:Measure:qk]'
    expect(out).toContain('[Superstore].[sum:Profit:qk]');
  });

  it('rewrites the rows/cols text-node refs and leaves no {{DATASOURCE}} or old field tokens', () => {
    const out = rewriteFieldReferences(rankingOrderedBar, mapping, datasource);
    expect(out).not.toContain('{{DATASOURCE}}');
    expect(out).not.toContain(':Category:');
    expect(out).not.toContain(':Measure:');
  });

  it('CONVERGENCE: keeps the lowercase short code for the dimension instance too (none, not None)', () => {
    // CONVERGENCE: same lowercase-short-code fix as kpi-text — `[none:Category:nk]`
    // becomes `[none:Segment:nk]` (not the old `[None:Segment:nk]`) in every
    // rewritten ref.
    const out = rewriteFieldReferences(rankingOrderedBar, mapping, datasource);
    expect(out).toContain('[none:Segment:nk]');
    expect(out).not.toContain('[None:Segment:nk]');
  });
});

describe('rewriteFieldReferences — pareto-chart (compound derivation / Parameters / calc)', () => {
  const mapping = {
    Sales: '[DS].[sum:Profit:qk]',
    'Sub-Category': '[DS].[none:Segment:nk]',
  };
  const datasource = 'Superstore';

  it('rewrites the simple aggregated ref', () => {
    // CONVERGENCE: lowercase short code (`sum`), not the old capitalized `Sum`.
    const out = rewriteFieldReferences(pareto, mapping, datasource);
    expect(out).toContain('[Superstore].[sum:Profit:qk]');
    expect(out).not.toContain('{{DATASOURCE}}');
    expect(out).not.toContain('Sub-Category');
  });

  it('CONVERGENCE: DOES remap the field inside a compound-derivation ref (Sales→Profit)', () => {
    // CONVERGENCE: the shared rewriter parses COMPOUND (table-calc) derivations
    // colon-tolerantly, so `[{{DATASOURCE}}].[pcto:cum:sum:Sales:qk]` now remaps
    // its field `Sales`→`Profit` while PRESERVING the `pcto:cum` wrapper — the
    // W10-E8 gap the old single-segment regex left behind is closed.
    const out = rewriteFieldReferences(pareto, mapping, datasource);
    expect(out).toContain('[Superstore].[pcto:cum:sum:Profit:qk]');
    expect(out).not.toContain('[pcto:cum:sum:Sales:qk]');
    // Side-by-side proof in the <rows> formula: BOTH the simple ref and the
    // compound ref are now remapped.
    expect(out).toContain('([Superstore].[sum:Profit:qk] + [Superstore].[pcto:cum:sum:Profit:qk])');
  });

  it('CONVERGENCE: rewrites the column-instance name of the compound ref (Sales→Profit)', () => {
    // CONVERGENCE: the `<column-instance name='[pcto:cum:sum:Sales:qk]'>` field
    // segment is now parsed correctly, so the rebuilt instance name reads
    // `Profit`, not `Sales`.
    const out = rewriteFieldReferences(pareto, mapping, datasource);
    expect(out).toContain('[pcto:cum:sum:Profit:qk]');
    expect(out).not.toContain('[pcto:cum:sum:Sales:qk]');
  });

  it('CHARACTERIZATION: does not rewrite the [:Measure Names] pseudo-field ref (only fills datasource)', () => {
    // CHARACTERIZATION: `[{{DATASOURCE}}].[:Measure Names]` has no derivation/field
    // segments to map, so only {{DATASOURCE}} is substituted.
    const out = rewriteFieldReferences(pareto, mapping, datasource);
    expect(out).toContain('[Superstore].[:Measure Names]');
  });

  it('CHARACTERIZATION: leaves the Parameters datasource and its calc caption untouched', () => {
    // CHARACTERIZATION: no calc-caption rewrite — the parameter column caption ('80%')
    // and the literal `[Parameters].[Parameter 3]` refs / `Parameters` datasource name
    // are left exactly as authored.
    const out = rewriteFieldReferences(pareto, mapping, datasource);
    expect(out).toContain('[Parameters].[Parameter 3]');
    // Serializer re-quotes attributes to double quotes; the caption VALUE ('80%')
    // is what we pin — it is passed through untouched.
    expect(out).toContain('caption="80%"');
    expect(out).toContain('formula');
  });
});

describe('rewriteFieldReferences — fallback / error behavior', () => {
  it('empty mapping fills {{DATASOURCE}} but rewrites no field refs', () => {
    const out = rewriteFieldReferences(kpiText, {}, 'Sales Data');
    // Datasource filled...
    expect(out).toContain('[Sales Data].[sum:Value:qk]');
    // ...but the field ref is left verbatim (derivation short code preserved).
    expect(out).toContain('[Value]');
    expect(out).not.toContain('{{DATASOURCE}}');
  });

  it('unmapped field (mapping targets a field the template does not contain) leaves refs alone', () => {
    const out = rewriteFieldReferences(kpiText, { Nonexistent: '[DS].[sum:Foo:qk]' }, 'Sales Data');
    expect(out).toContain('[Sales Data].[sum:Value:qk]');
    expect(out).toContain('[Value]');
    expect(out).not.toContain('Foo');
  });

  it('CHARACTERIZATION: silently skips a mapping entry whose column-instance value is malformed', () => {
    // CHARACTERIZATION: buildFieldInfoMap `continue`s past values that do not match
    // `[<deriv>:<field>:<role>]`, so a garbage mapping value is a no-op (no throw),
    // and the template ref is left with only {{DATASOURCE}} filled.
    const out = rewriteFieldReferences(kpiText, { Value: 'garbage-no-brackets' }, 'Sales Data');
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
    expect(() => rewriteFieldReferences('', {}, 'X')).toThrow(/root element/);
  });

  it('returns a string for well-formed XML that contains no mappable refs', () => {
    const out = rewriteFieldReferences('<workbook><table/></workbook>', {}, 'X');
    expect(typeof out).toBe('string');
    expect(out).toContain('<workbook>');
  });
});
