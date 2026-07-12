import fs from 'fs';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

import { bindTemplate } from './binder.js';
import { loadManifests } from './manifest.js';
import type { TemplateManifest } from './manifest-types.js';

// W60-INVARIANT-TESTS suite 3 — BIND BEHAVIOR MATRIX (the ww-ou-arrow regression lock).
//
// Live-caught tonight: 'over-under arrow chart of ...' happily bound ww-ou-arrow on the
// no-LLM path and fed a plain dimension into sports-score SPLIT parsing (fix b1490be5 —
// compound-string-parse hazard demotion). This suite pins the whole observable bind
// surface against the committed Superstore fixture so a future change to classify.ts /
// the manifests can never silently flip a one-shot into a wrong bind or a fail-closed
// propose into a bind.
//
// FIXTURE: the committed Superstore reference (Sample - Superstore) copied verbatim from
// the factory (a2td tests/fixtures/superstore-scratch-ref.xml) into the repo test tree —
// scope rules forbid a test reading an external absolute path, so the fixture is a
// committed test asset here. Schema summarizes to (measures) Sales/Profit/Quantity/
// Discount and (dims) Sub-Category/Category/Segment/Region/State-Province/Country-Region/
// Order Date(temporal)/... .
//
// bindTemplate is called with loadManifests() (NATIVE eligibility — the render-verified
// templates, no forced-eligible cloning) and NO proposal / NO llmPropose, so every result
// is the pure Call-1 no-LLM decision: 'bound' (used_llm=false) or 'propose'.

const FIXTURE = fs.readFileSync(
  path.join(process.cwd(), 'src', 'desktop', 'binder', 'fixtures', 'superstore-scratch-ref.xml'),
  'utf8',
);

const EXPECTED_DATASOURCE = 'Sample - Superstore';

// The render-verified fast_path_eligible set this matrix pins. Kept as an explicit list so
// a NEW eligibility stamp trips the coverage tripwire below and forces this matrix to be
// extended (per the discover-and-pin contract) rather than silently under-covering.
const EXPECTED_ELIGIBLE = [
  'box-plot-chart',
  'control-chart-xmr',
  'correlation-bubble-chart',
  'correlation-scatter-plot-chart', // W60 parity port: factory stamp crossed
  'distribution-bar-code-chart',
  'funnel-chart',
  'gantt-task-rollup-chart',
  'kpi-text',
  'magnitude-simple-bar',
  'part-to-whole-pie-chart',
  'part-to-whole-stacked-bar-chart',
  'part-to-whole-treemap-chart',
  'part-to-whole-waterfall',
  'quota-attainment-bullet',
  'ranking-ordered-bar',
  'ranking-ordered-column',
  'spatial-choropleth-map',
  'spatial-symbol-map',
  'trend-line-chart',
  'ww-ou-arrow',
].sort();

let manifests: Map<string, TemplateManifest>;
let eligibleNames: string[];

beforeAll(() => {
  manifests = loadManifests();
  eligibleNames = [...manifests.values()]
    .filter((m) => m.fast_path_eligible)
    .map((m) => m.template)
    .sort();
});

function bind(ask: string): ReturnType<typeof bindTemplate> {
  return bindTemplate({ ask, workbookXml: FIXTURE, manifests });
}

// ── KNOWN ONE-SHOTS (bound, used_llm=false, correct template) ─────────────────
const ONE_SHOTS: ReadonlyArray<readonly [ask: string, template: string]> = [
  ['bar chart of Sales by Sub-Category', 'ranking-ordered-bar'],
  ['treemap of Sales by Category and Sub-Category', 'part-to-whole-treemap-chart'],
  ['line chart of Sales by Order Date', 'trend-line-chart'],
  ['waterfall of Profit by Sub-Category', 'part-to-whole-waterfall'],
  // W60 parity port: scatter's factory stamp crossed; full-phrasing ask one-shots
  // (the bare 'scatter of Profit vs Sales' phrasing proposes — no 'scatter' chart noun).
  ['scatter plot of Profit and Sales by Sub-Category', 'correlation-scatter-plot-chart'],
  // W60 geo-slot completion: the required country slot has ZERO ask-named candidates, so
  // it widens to the full schema and binds the unique country-affine field
  // [Country/Region]; the ask-named [State/Province] fills the state slot. MOVED here
  // from PINNED_PROPOSE (was fail-closed pre-W60) — see resolveGeoSlots widening.
  ['filled map of Profit by State/Province', 'spatial-choropleth-map'],
  ['pie chart of Sales by Segment', 'part-to-whole-pie-chart'],
  [
    'symbol map of Sales by Country/Region, State/Province, and City',
    'spatial-symbol-map',
  ],
];

// ── KNOWN SAFE-PROPOSES (NOT bound — fail-closed by design; WHY each) ──────────
const SAFE_PROPOSES: ReadonlyArray<readonly [ask: string, why: string]> = [
  [
    'over-under arrow chart of Sales by Sub-Category',
    // fix b1490be5: ww-ou-arrow carries the compound-string-parse hazard (its calcs SPLIT a
    // sports-score string shape out of a bound field). That risk lives in the DATA, invisible
    // to any natural ask, so classifyNoLlm demotes the template unconditionally to propose.
    'compound-string-parse hazard demotion (ww-ou-arrow)',
  ],
  [
    'gantt of Sales by Sub-Category',
    // gantt-task-rollup-chart requires start_date(temporal) + duration(quantitative) +
    // phase(categorical) + task(categorical); the ask names only Sales + Sub-Category, so the
    // temporal/duration/second-categorical slots are unfilled → role-greedy bind fails closed.
    'required temporal/duration/phase slots unfilled (gantt-task-rollup-chart)',
  ],
  [
    'quota attainment bullet of Sales by Segment',
    // quota-attainment-bullet requires TWO quantitative slots: actual + quota. Only Sales is
    // named (role-greedy binds only ask-NAMED fields), so the quota slot is unfilled → propose.
    'no second (quota) measure named → quota slot unfilled (quota-attainment-bullet)',
  ],
  [
    'sankey of customer order flows between regions',
    // No eligible template carries 'sankey'/'flow' vocabulary → zero keyword score → propose.
    'out of vocabulary (no eligible keyword match)',
  ],
];

// ── DISCOVER-AND-PIN: eligible templates NOT in the one-shot list. Natural ask built from
//    the manifest's intent keywords + Superstore fields, RUN once, observed status pinned as
//    pinned-current-behavior (no behavior change — this pins what IS). ─────────────
// Pinned BOUND (bound → assert template + used_llm=false):
const PINNED_BOUND: ReadonlyArray<readonly [ask: string, template: string, note: string]> = [
  [
    'box plot of Sales by Sub-Category',
    'box-plot-chart',
    'pinned-current-behavior: measure=Sales + level=Sub-Category fill the two required slots',
  ],
  [
    'funnel chart of Sales by Segment',
    'funnel-chart',
    'pinned-current-behavior: stage=Segment + amount=Sales fill the two required slots',
  ],
  ['kpi of Sales', 'kpi-text', 'pinned-current-behavior: single required quantitative value=Sales'],
  [
    'stacked bar of Sales by Category and Sub-Category',
    'part-to-whole-stacked-bar-chart',
    'pinned-current-behavior: two categoricals + Sales fill region/category/sales',
  ],
  [
    'column chart of Sales by Sub-Category',
    'ranking-ordered-column',
    "pinned-current-behavior: distinct 'column' chart noun one-shots the ordered-column sibling",
  ],
  [
    'filled map of Profit by State/Province and Country/Region',
    'spatial-choropleth-map',
    'pinned-current-behavior: two geo dims (state/country name affinity) + Profit fill all three slots',
  ],
  [
    'magnitude chart of Sales by Category',
    'magnitude-simple-bar',
    'pinned-current-behavior: magnitude intent + Sales + Category fill the simple magnitude bar slots',
  ],
];

// Pinned NOT-BOUND (propose → assert not-bound):
const PINNED_PROPOSE: ReadonlyArray<readonly [ask: string, note: string]> = [
  [
    'strip plot of Sales by Sub-Category',
    // distribution-bar-code-chart's required slots include country_region + state_province
    // (both geo); a Sales-by-Sub-Category ask names no geo field → geo slots unfilled → propose.
    'pinned-current-behavior: distribution-bar-code-chart requires two geo slots — none named → fail closed',
  ],
  [
    'control chart of Profit by Order Date',
    'pinned-current-behavior: W62 stamp made control-chart-xmr eligible, but no-LLM classifier still proposes on this phrasing',
  ],
  [
    'bubble chart of Profit, Discount, and Sales by Order ID',
    'pinned-current-behavior: W62 stamp made correlation-bubble-chart eligible, but no-LLM classifier still proposes on this phrasing',
  ],
  // NB (W60): 'filled map of Profit by State/Province' MOVED to the ONE_SHOTS table — the
  // required country geo slot now auto-completes from the schema (Country/Region) when the
  // state slot is ask-named. The distribution-bar-code strip-plot case above stays here:
  // its ask names NO geo field, so no geo slot is ask-satisfied → no widening → fail closed.
];

describe('binder/bind-behavior-matrix — eligibility tripwire', () => {
  it('the eligible set is exactly the 20 render-verified templates this matrix covers', () => {
    // If a NEW template is stamped fast_path_eligible, this fails — extend the matrix
    // (add its one-shot / discover-and-pin entry) deliberately rather than under-cover it.
    expect(eligibleNames).toEqual(EXPECTED_ELIGIBLE);
  });

  it('fixture summarizes to the Sample - Superstore datasource', async () => {
    const { summarizeSchema } = await import('./binder.js');
    const s = summarizeSchema(FIXTURE);
    expect(s.datasource).toBe(EXPECTED_DATASOURCE);
    // Sanity: the fields the matrix asks for exist with the expected roles.
    const byName = new Map(s.fields.map((f) => [f.name, f]));
    expect(byName.get('Sales')?.role).toBe('measure');
    expect(byName.get('Profit')?.role).toBe('measure');
    expect(byName.get('Sub-Category')?.role).toBe('dimension');
    expect(byName.get('Segment')?.role).toBe('dimension');
    expect(byName.get('Order Date')?.datatype).toBe('date');
  });
});

describe('binder/bind-behavior-matrix — KNOWN one-shots', () => {
  it.each(ONE_SHOTS)('%s → bound %s (used_llm=false)', async (ask, template) => {
    const res = await bind(ask);
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      expect(res.used_llm).toBe(false);
      expect(res.args.template_name).toBe(template);
      expect(res.args.template_parameters.DATASOURCE).toBe(EXPECTED_DATASOURCE);
    }
  });
});

describe('binder/bind-behavior-matrix — KNOWN safe-proposes (fail-closed by design)', () => {
  it.each(SAFE_PROPOSES)('%s → NOT bound (%s)', async (ask) => {
    const res = await bind(ask);
    expect(res.status, `${ask} must fail closed (not bound)`).not.toBe('bound');
  });
});

describe('binder/bind-behavior-matrix — CROSS-BIND GUARD (N×N)', () => {
  // For every (one-shot ask, eligible template) pair, the ask must bind to its EXPECTED
  // template and NEVER to any other eligible template. Iterates programmatically over the
  // eligible set so a future keyword/manifest change that lets an ask reach a sibling is
  // caught for every template, not just the expected one.
  it.each(ONE_SHOTS)(
    '%s binds ONLY to %s across the entire eligible set',
    async (ask, expected) => {
      const res = await bind(ask);
      expect(res.status).toBe('bound');
      if (res.status === 'bound') {
        expect(res.args.template_name).toBe(expected);
        for (const name of eligibleNames) {
          if (name === expected) continue;
          expect(res.args.template_name, `${ask} must never bind to ${name}`).not.toBe(name);
        }
      }
    },
  );
});

describe('binder/bind-behavior-matrix — DISCOVER-AND-PIN (pinned-current-behavior)', () => {
  it.each(PINNED_BOUND)('%s → bound %s [%s]', async (ask, template) => {
    const res = await bind(ask);
    expect(res.status, `${ask} pinned bound`).toBe('bound');
    if (res.status === 'bound') {
      expect(res.used_llm).toBe(false);
      expect(res.args.template_name).toBe(template);
      expect(res.args.template_parameters.DATASOURCE).toBe(EXPECTED_DATASOURCE);
    }
  });

  it.each(PINNED_PROPOSE)('%s → NOT bound [%s]', async (ask) => {
    const res = await bind(ask);
    expect(res.status, `${ask} pinned not-bound`).not.toBe('bound');
  });
});
