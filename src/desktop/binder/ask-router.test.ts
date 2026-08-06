// src/desktop/binder/ask-router.test.ts
//
// The route layer's SELECTOR. Pins that selectEligible reuses the binder's model-free matcher
// (unique decisive keyword-argmax over the fast_path_eligible pool) and NEVER selects unproven
// supply, plus the CHART_NOUN_KEYWORDS lockstep parity with classify.ts (the hand-maintained
// mirror MUST equal the hash-gated classifier's table exactly, and this file must import
// NOTHING from classify.ts).

import fs from 'fs';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

import { loadRuntimeTemplateDescriptors } from '../templates/runtimeTemplateCatalog.js';
import { selectEligible } from './ask-router.js';
import { classifyNoLlm, summarizeSchema } from './binder.js';
import type { RuntimeTemplateDescriptor } from './manifest-types.js';

const repoRoot = path.resolve(__dirname, '..', '..', '..');

let manifestMap: Map<string, RuntimeTemplateDescriptor>;
let manifests: RuntimeTemplateDescriptor[];
beforeAll(() => {
  manifestMap = loadRuntimeTemplateDescriptors();
  manifests = [...manifestMap.values()];
});

/** A minimal, structurally-sufficient manifest for matcher/eligibility pinning. */
function mkManifest(
  over: Partial<RuntimeTemplateDescriptor> & { template: string },
): RuntimeTemplateDescriptor {
  return {
    family: 'specialized',
    fast_path_eligible: true,
    fast_path_blockers: [],
    intent_keywords: [],
    description: 'synthetic test manifest',
    slots: [],
    calcs: [],
    ...over,
  };
}

describe('selectEligible — reuses the binder matcher, fail-closed on unproven/ambiguous supply', () => {
  it('selects the decisive eligible template for a plain bar ask', () => {
    const supply = [
      mkManifest({
        template: 'ranking-ordered-bar',
        family: 'ranking',
        intent_keywords: ['bar', 'ranked'],
      }),
    ];
    const m = selectEligible('bar chart of sales by region', supply);
    expect(m).not.toBeNull();
    expect(m!.template).toBe('ranking-ordered-bar');
  });

  it('returns null for gibberish (nothing scores)', () => {
    expect(selectEligible('asdf qwerty zxcv plok', manifests)).toBeNull();
  });

  it('selects a stamped template but NEVER an unstamped one for the same ask', () => {
    const ask = 'frobnicate chart of things';
    const stamped = mkManifest({ template: 'frob', intent_keywords: ['frobnicate'] });
    const unstamped = mkManifest({
      template: 'frob',
      intent_keywords: ['frobnicate'],
      fast_path_eligible: false,
    });
    expect(selectEligible(ask, [stamped])?.template).toBe('frob');
    expect(selectEligible(ask, [unstamped])).toBeNull();
  });

  it('fail-closed on a keyword-score tie (two templates argmax) — returns null', () => {
    const a = mkManifest({ template: 'a-chart', family: 'ranking', intent_keywords: ['widget'] });
    const b = mkManifest({
      template: 'b-chart',
      family: 'distribution',
      intent_keywords: ['widget'],
    });
    expect(selectEligible('a widget please', [a, b])).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CUE-LIST LOCKSTEP PARITY — vocabulary SET EQUALITY only (CHART_NOUN_KEYWORDS
// here; SPATIAL_INTENT_ALIASES and SYMBOL_MAP_MARK_CUES below). The ask-router
// mirror MUST equal the classify.ts table EXACTLY, and this file must keep
// importing NOTHING from classify.ts (the hash-gated classifier stays
// byte-untouched). This checks the WORD LISTS match, not that behavior matches —
// see the "shared behavioral table" describe block below for that.
describe('ask-router — cue-list lockstep parity with classify.ts (CHART_NOUN_KEYWORDS)', () => {
  const ASK_ROUTER_SRC = path.join(repoRoot, 'src', 'desktop', 'binder', 'ask-router.ts');
  const CLASSIFY_SRC = path.join(repoRoot, 'src', 'desktop', 'binder', 'classify.ts');

  // Regex-extract the CHART_NOUN_KEYWORDS Set literal's string members from a source file.
  // ANCHORED on `const CHART_NOUN_KEYWORDS` so the PLURALIZABLE_CHART_NOUNS set (whose doc
  // comment mentions CHART_NOUN_KEYWORDS) can never match by accident; STRIPS `//` line
  // comments first so growth-provenance prose that quotes example phrases is ignored and only
  // the real entries remain.
  function extractChartNouns(file: string): Set<string> {
    const src = fs.readFileSync(file, 'utf8');
    const m = src.match(/const\s+CHART_NOUN_KEYWORDS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
    expect(m, `CHART_NOUN_KEYWORDS Set literal not found in ${file}`).not.toBeNull();
    const body = m![1].replace(/\/\/[^\n]*/g, '');
    const nouns = [...body.matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1].toLowerCase());
    expect(nouns.length, `${file}: expected a non-empty CHART_NOUN_KEYWORDS table`).toBeGreaterThan(
      0,
    );
    return new Set(nouns);
  }

  it('both source files declare the SAME CHART_NOUN_KEYWORDS set (set equality)', () => {
    const ask = extractChartNouns(ASK_ROUTER_SRC);
    const classify = extractChartNouns(CLASSIFY_SRC);
    expect([...ask].sort()).toEqual([...classify].sort());
  });

  it('ask-router.ts imports NOTHING from classify.ts (the classifier stays untouched)', () => {
    const src = fs.readFileSync(ASK_ROUTER_SRC, 'utf8');
    // Match only real module specifiers (quoted); the file's prose comment naming classify.ts
    // is unquoted and must not trip this.
    expect(src).not.toMatch(/from\s+['"][^'"]*\/classify[^'"]*['"]/);
    expect(src).not.toMatch(/import\(\s*['"][^'"]*\/classify[^'"]*['"]\s*\)/);
  });
});

describe('ask-router — spatial-intent family guard (W-23447710)', () => {
  it('selectEligible refuses a non-spatial winner when the ask carries map intent', () => {
    const ms = [
      mkManifest({
        template: 'rank-map-trap',
        family: 'ranking',
        intent_keywords: ['top', 'highest'],
      }),
      mkManifest({ template: 'spatial-carrier', family: 'spatial', intent_keywords: ['map'] }),
    ];
    const ask = 'map of top sales by region, highest first';
    expect(selectEligible(ask, ms, ask)).toBeNull();
  });

  it('selectEligible still binds non-map asks decisively', () => {
    const ms = [
      mkManifest({ template: 'rank-bar', family: 'ranking', intent_keywords: ['bar'] }),
      mkManifest({ template: 'spatial-carrier', family: 'spatial', intent_keywords: ['map'] }),
    ];
    const ask = 'bar chart of sales by region';
    expect(selectEligible(ask, ms, ask)?.template).toBe('rank-bar');
  });

  it('SPATIAL_INTENT_ALIASES stays lockstep with classify.ts (set equality)', () => {
    function extractAliases(file: string): Set<string> {
      const src = fs.readFileSync(file, 'utf8');
      const m = src.match(/const\s+SPATIAL_INTENT_ALIASES[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
      expect(m, `SPATIAL_INTENT_ALIASES Set literal not found in ${file}`).not.toBeNull();
      const body = m![1].replace(/\/\/[^\n]*/g, '');
      return new Set([...body.matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1].toLowerCase()));
    }
    const askRouterAliases = extractAliases(
      path.join(repoRoot, 'src', 'desktop', 'binder', 'ask-router.ts'),
    );
    const classifyAliases = extractAliases(
      path.join(repoRoot, 'src', 'desktop', 'binder', 'classify.ts'),
    );
    expect([...askRouterAliases].sort()).toEqual([...classifyAliases].sort());
  });

  it('SYMBOL_MAP_MARK_CUES stays lockstep with classify.ts (set equality)', () => {
    function extractMarkCues(file: string): Set<string> {
      const src = fs.readFileSync(file, 'utf8');
      const m = src.match(/const\s+SYMBOL_MAP_MARK_CUES[^=]*=\s*\[([\s\S]*?)\]/);
      expect(m, `SYMBOL_MAP_MARK_CUES array literal not found in ${file}`).not.toBeNull();
      const body = m![1].replace(/\/\/[^\n]*/g, '');
      return new Set([...body.matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1].toLowerCase()));
    }
    const askRouterCues = extractMarkCues(
      path.join(repoRoot, 'src', 'desktop', 'binder', 'ask-router.ts'),
    );
    const classifyCues = extractMarkCues(
      path.join(repoRoot, 'src', 'desktop', 'binder', 'classify.ts'),
    );
    expect([...askRouterCues].sort()).toEqual([...classifyCues].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SHARED BEHAVIORAL TABLE — cue-list parity (above) only proves the two files
// declare the SAME WORDS; it says nothing about whether they SELECT the same
// template for a given ask. This table runs each ask through BOTH classifyNoLlm
// (the real, schema-aware binder) and selectEligible (the schema-free route
// selector) against the SAME schema/manifests and asserts identical outcomes, so
// a future edit that changes one file's selection logic without the other shows
// up here as a red test instead of silently drifting.
//
// Scoped to asks where the two are EXPECTED to agree: plain decisive
// keyword-argmax winners, and the spatial mark-cue tie-break (which
// selectEligible now mirrors). Deliberately excludes asks that only classify.ts
// can resolve (the lat/lon coordinate resolver, which needs real Latitude/
// Longitude schema fields and has no route-layer equivalent) and mark-cue asks
// naming NO measure (classify.ts's fail-closed "never invent a size measure"
// guard has no schema-free equivalent in selectEligible) — those are known,
// accepted asymmetries between a schema-aware binder and a schema-free selector,
// not drift.
describe('ask-router — shared behavioral parity with classify.ts (selection outcomes)', () => {
  const COMBO_WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='Combo'>
      <column name='[Region]' role='dimension' type='nominal' datatype='string' />
      <column name='[Category]' role='dimension' type='nominal' datatype='string' />
      <column name='[Sub-Category]' role='dimension' type='nominal' datatype='string' />
      <column name='[Sales]' role='measure' type='quantitative' datatype='real' />
      <column name='[Profit]' role='measure' type='quantitative' datatype='real' />
      <column name='[Country Code]' caption='Country Code' role='dimension' type='nominal' datatype='string' semantic-role='[Country].[ISO3166_2]' />
      <column name='[Goals For]' caption='Goals For' role='measure' type='quantitative' datatype='integer' />
    </datasource>
  </datasources>
</workbook>`;

  it.each([
    'bar chart of sales by region',
    'gibberish asdf qwerty zxcv',
    'Symbol map of Goals For by Country Code.',
  ])('classifyNoLlm and selectEligible pick the same template for: %s', (ask) => {
    const cls = classifyNoLlm(ask, manifestMap, summarizeSchema(COMBO_WORKBOOK_XML));
    const routed = selectEligible(ask, manifests, ask);
    expect(routed?.template ?? null).toBe(cls?.template ?? null);
  });

  it.each([
    'Map the countries by Goals For — bigger, warmer dots',
    'Map the countries by Goals For with bigger warmer dots total',
    'Map the countries by Goals For with bigger, warmer circles',
  ])('keeps schema-free spatial shortlisting separate from schema-aware binding for: %s', (ask) => {
    const cls = classifyNoLlm(ask, manifestMap, summarizeSchema(COMBO_WORKBOOK_XML));
    const routed = selectEligible(ask, manifests, ask);
    expect(routed?.family).toBe('spatial');
    expect(cls).toBeNull();
  });

  it('lets schema-aware geo binding resolve a choropleth catalog choice that routing leaves open', () => {
    const ask = 'Choropleth map of Goals For by Country Code.';
    const cls = classifyNoLlm(ask, manifestMap, summarizeSchema(COMBO_WORKBOOK_XML));
    const routed = selectEligible(ask, manifests, ask);

    expect(routed).toBeNull();
    expect(cls?.template).toBe('spatial__choropleth__map-rates-or-ratios-by-region');
  });

  it('allows schema-aware waterfall binding to resolve catalog ambiguity that routing cannot', () => {
    const ask = 'waterfall of Profit by Sub-Category';
    const cls = classifyNoLlm(ask, manifestMap, summarizeSchema(COMBO_WORKBOOK_XML));
    const routed = selectEligible(ask, manifests, ask);
    expect(routed).toBeNull();
    expect(cls?.template).toContain('waterfall');
  });
});
