import fs from 'fs';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

import { loadManifests } from './manifest.js';
import type { TemplateManifest } from './manifest-types.js';

// W60-INVARIANT-TESTS suite 1 — CARRIER-UNIQUENESS.
//
// Ported from the factory invariant (agent-to-tableau-desktop
// src/binder/manifest.test.ts, the "every classify.ts CHART_NOUN_KEYWORD is carried
// by <=1 fast_path_eligible manifest" test). The factory read classify.ts from
// src/lockstep-core/classify.ts; here the frozen table lives in
// src/desktop/binder/classify.ts.
//
// WHY THIS IS THE REGRESSION LOCK: a CHART_NOUN_KEYWORD is a DETERMINISTIC chart-type
// selector. classifyNoLlm's lone-winner exemption (selectWithinFamily) auto-binds a
// lone chart-noun match even when the noun is not family-native by strict majority.
// That is only SAFE while the noun uniquely identifies ONE fast_path_eligible template
// — a second eligible carrier of the same noun re-opens the exact sibling-scaling
// class the CHART_NOUN_KEYWORDS table exists to prevent (an ambiguous noun would
// silently bind to whichever carrier wins the name tiebreak).
//
// PORT NOTE on the task's phrasing ("EXACTLY ONE"): the true invariant is AT MOST ONE
// (<= 1) carrier — the factory locks `carriers.length > 1` as the collision. It is NOT
// "exactly one" universally: several nouns in the table name templates that are NOT yet
// fast_path_eligible, so they are carried by ZERO eligible manifests today (see the
// pinned zero-carrier set below — pie/donut/histogram/slope*). Asserting a blanket
// `=== 1` would FALSE-FAIL on those. So this suite locks <= 1 for every noun (the real
// regression), and pins the exact single-carrier / zero-carrier split as
// pinned-current-behavior. The task's regression-context claims (waterfall / choropleth
// / filled-map / region-map are single-carrier; 'map' is deliberately absent as a
// dual-carrier) are asserted explicitly.

const CLASSIFY_TS_PATH = path.join(process.cwd(), 'src', 'desktop', 'binder', 'classify.ts');

/**
 * Regex-extract the CHART_NOUN_KEYWORDS Set members from classify.ts source (the
 * table is a private const — not exported — so it cannot be imported). Mirrors the
 * factory extractor: ANCHOR on `const CHART_NOUN_KEYWORDS` (so PLURALIZABLE_CHART_NOUNS,
 * whose comment mentions CHART_NOUN_KEYWORDS, cannot match) and STRIP `//` comments
 * (classify.ts's growth-provenance prose quotes example phrases in comments) so only
 * real Set members remain.
 */
function extractChartNouns(): string[] {
  const src = fs.readFileSync(CLASSIFY_TS_PATH, 'utf8');
  const mm = src.match(/const\s+CHART_NOUN_KEYWORDS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
  expect(mm, 'CHART_NOUN_KEYWORDS Set literal not found in classify.ts').not.toBeNull();
  const body = mm![1].replace(/\/\/[^\n]*/g, '');
  return [...body.matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1].toLowerCase());
}

let manifests: Map<string, TemplateManifest>;
let eligible: TemplateManifest[];
let nouns: string[];

/** Fast_path_eligible manifests whose (lowercased) intent_keywords include `noun`. */
function carriersOf(noun: string): string[] {
  return eligible
    .filter((m) => m.intent_keywords.map((k) => k.toLowerCase()).includes(noun))
    .map((m) => m.template)
    .sort();
}

beforeAll(() => {
  manifests = loadManifests();
  eligible = [...manifests.values()].filter((m) => m.fast_path_eligible);
  nouns = extractChartNouns();
});

describe('binder/carrier-uniqueness — CHART_NOUN_KEYWORDS ↔ eligible manifests', () => {
  it('extracts a non-empty CHART_NOUN_KEYWORDS table from classify.ts', () => {
    expect(nouns.length, 'expected a non-empty CHART_NOUN_KEYWORDS table').toBeGreaterThan(0);
    expect(eligible.length, 'expected at least one fast_path_eligible manifest').toBeGreaterThan(0);
  });

  it('every CHART_NOUN_KEYWORD is carried by AT MOST ONE fast_path_eligible manifest', () => {
    const collisions: string[] = [];
    for (const noun of new Set(nouns)) {
      const carriers = carriersOf(noun);
      if (carriers.length > 1) {
        collisions.push(`'${noun}' carried by ${carriers.length}: [${carriers.join(', ')}]`);
      }
    }
    expect(
      collisions,
      'a chart noun carried by >=2 eligible manifests re-opens the sibling-scaling class',
    ).toEqual([]);
  });

  // ── Task regression context: tonight's additions are single-carrier ──────────
  it("tonight's additions (waterfall/choropleth/filled-map/region-map) are each single-carrier", () => {
    expect(nouns).toContain('waterfall');
    expect(nouns).toContain('choropleth');
    expect(nouns).toContain('filled-map');
    expect(nouns).toContain('region-map');

    expect(carriersOf('waterfall')).toEqual(['part-to-whole-waterfall']);
    expect(carriersOf('choropleth')).toEqual(['spatial-choropleth-map']);
    expect(carriersOf('filled-map')).toEqual(['spatial-choropleth-map']);
    expect(carriersOf('region-map')).toEqual(['spatial-choropleth-map']);
  });

  it("the deviation/distribution incumbents' nouns (arrow-chart/over-under-arrow, bar-code/strip-plot/dot-strip) stay single-carrier", () => {
    // ww-ou-arrow regression provenance (fix b1490be5) + the distribution-bar-code
    // sibling-scaling event both live in this table; pin their carriers.
    expect(carriersOf('arrow-chart')).toEqual(['ww-ou-arrow']);
    expect(carriersOf('over-under-arrow')).toEqual(['ww-ou-arrow']);
    expect(carriersOf('bar-code')).toEqual(['distribution-bar-code-chart']);
    expect(carriersOf('strip-plot')).toEqual(['distribution-bar-code-chart']);
    expect(carriersOf('dot-strip')).toEqual(['distribution-bar-code-chart']);
  });

  it("the newly stamped pie nouns (pie/donut) are each single-carrier", () => {
    expect(carriersOf('pie')).toEqual(['part-to-whole-pie-chart']);
    expect(carriersOf('donut')).toEqual(['part-to-whole-pie-chart']);
  });

  it("the generic 'map' is DELIBERATELY absent from CHART_NOUN_KEYWORDS (dual-carrier hazard)", () => {
    // 'map' is an intent_keyword of BOTH spatial-choropleth-map and spatial-symbol-map,
    // so admitting it would make the lone-winner exemption ambiguous the moment
    // spatial-symbol-map is stamped. classify.ts keeps it OUT on purpose.
    expect(nouns).not.toContain('map');
    // Corroborate the dual-carrier reason from the manifest data (across ALL bundled
    // manifests, not just eligible ones): 'map' is carried by >=2 templates.
    const mapCarriers = [...manifests.values()]
      .filter((m) => m.intent_keywords.map((k) => k.toLowerCase()).includes('map'))
      .map((m) => m.template);
    expect(mapCarriers.length).toBeGreaterThanOrEqual(2);
  });

  // ── Pinned-current-behavior: the exact single-carrier / zero-carrier split ───
  // Documents (and locks) the reality that "exactly one carrier" is NOT universal:
  // nouns whose template is not yet fast_path_eligible carry ZERO eligible carriers.
  // If a future stamp (e.g. distribution-histogram, slope-chart, part-to-whole-pie)
  // moves a noun from zero → one carrier, this pin fails and forces a deliberate
  // re-review — which is the intended tripwire, not a false alarm.
  it('pins the zero-carrier nouns (templates present but not yet stamped eligible)', () => {
    const zeroCarrier = [...new Set(nouns)].filter((n) => carriersOf(n).length === 0).sort();
    expect(zeroCarrier).toEqual(['histogram', 'slope', 'slope-chart', 'slope-graph'].sort());
  });

  it('every non-zero-carrier noun has exactly one carrier (no >1 slips past the split)', () => {
    for (const noun of new Set(nouns)) {
      const n = carriersOf(noun).length;
      expect([0, 1], `'${noun}' carrier count ${n} must be 0 or 1`).toContain(n);
    }
  });
});
