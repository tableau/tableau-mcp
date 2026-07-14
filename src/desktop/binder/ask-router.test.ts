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

import { selectEligible } from './ask-router.js';
import { loadManifests } from './manifest.js';
import type { TemplateManifest } from './manifest-types.js';

const repoRoot = path.resolve(__dirname, '..', '..', '..');

let manifests: TemplateManifest[];
beforeAll(() => {
  manifests = [...loadManifests().values()];
});

/** A minimal, structurally-sufficient manifest for matcher/eligibility pinning. */
function mkManifest(over: Partial<TemplateManifest> & { template: string }): TemplateManifest {
  return {
    family: 'specialized',
    readiness: 'GREEN',
    fast_path_eligible: true,
    fast_path_blockers: [],
    intent_keywords: [],
    description: 'synthetic test manifest',
    placeholders: ['TITLE', 'DATASOURCE'],
    slots: [],
    calcs: [],
    ...over,
  } as unknown as TemplateManifest;
}

describe('selectEligible — reuses the binder matcher, fail-closed on unproven/ambiguous supply', () => {
  it('selects the decisive eligible template for a plain bar ask (real manifests)', () => {
    const m = selectEligible('bar chart of sales by region', manifests);
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
// CHART_NOUN_KEYWORDS LOCKSTEP PARITY — the ask-router mirror MUST equal the
// classify.ts table EXACTLY, and this file must keep importing NOTHING from classify.ts
// (the hash-gated classifier stays byte-untouched).
describe('ask-router — CHART_NOUN_KEYWORDS lockstep parity with classify.ts', () => {
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
      mkManifest({ template: 'rank-map-trap', family: 'ranking', intent_keywords: ['top', 'highest'] }),
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
    const askRouterAliases = extractAliases(path.join(repoRoot, 'src', 'desktop', 'binder', 'ask-router.ts'));
    const classifyAliases = extractAliases(path.join(repoRoot, 'src', 'desktop', 'binder', 'classify.ts'));
    expect([...askRouterAliases].sort()).toEqual([...classifyAliases].sort());
  });
});
