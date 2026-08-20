import fs from 'fs';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

import { createPuppetCompatibilityProjection } from '../templates/puppetCompatibilityProjection.js';
import { loadRuntimeTemplateCatalogSnapshots } from '../templates/runtimeTemplateCatalog.js';
import { bindTemplate } from './binder.js';
import type { RuntimeTemplateDescriptor } from './manifest-types.js';

// W60-INVARIANT-TESTS suite 3 — BIND BEHAVIOR MATRIX (the ww-ou-arrow regression lock).
//
// Live-caught tonight: 'over-under arrow chart of ...' happily bound ww-ou-arrow on the
// no-LLM path and fed a plain dimension into sports-score SPLIT parsing (fix b1490be5 —
// compound-string-parse hazard demotion). This suite pins the whole observable bind
// surface against the committed Superstore fixture so a future change to classify.ts /
// the runtime catalog can never silently flip a one-shot into a wrong bind or a fail-closed
// propose into a bind.
//
// FIXTURE: the committed Superstore reference (Sample - Superstore) copied verbatim from
// the factory (a2td tests/fixtures/superstore-scratch-ref.xml) into the repo test tree —
// scope rules forbid a test reading an external absolute path, so the fixture is a
// committed test asset here. Schema summarizes to (measures) Sales/Profit/Quantity/
// Discount and (dims) Sub-Category/Category/Segment/Region/State-Province/Country-Region/
// Order Date(temporal)/... .
//
// bindTemplate is called with the TBM-derived runtime descriptors and NO proposal / NO
// llmPropose, so every result
// is the pure Call-1 no-LLM decision: 'bound' (used_llm=false) or 'propose'.

const FIXTURE = fs.readFileSync(
  path.join(process.cwd(), 'src', 'desktop', 'binder', 'fixtures', 'superstore-scratch-ref.xml'),
  'utf8',
);

const EXPECTED_DATASOURCE = 'Sample - Superstore';

let manifests: Map<string, RuntimeTemplateDescriptor>;

beforeAll(() => {
  manifests = createPuppetCompatibilityProjection(
    loadRuntimeTemplateCatalogSnapshots({ automaticOnly: true, includeExternal: false }),
  ).descriptors;
});

function bind(ask: string): ReturnType<typeof bindTemplate> {
  return bindTemplate({ ask, workbookXml: FIXTURE, manifests });
}

// ── KNOWN ONE-SHOTS (bound, used_llm=false, correct template) ─────────────────
const ONE_SHOTS: ReadonlyArray<readonly [ask: string, template: string]> = [
  ['bar chart of Sales by Sub-Category', 'ranking-ordered-bar'],
  ['grouped bar chart of Sales by Category and Region', 'magnitude-paired-bar'],
  ['paired bar chart of Sales by Category and Region', 'magnitude-paired-bar'],
  ['line chart of Sales over Order Date by Category', 'trend-line-chart'],
  ['scatter plot of Sales vs Profit by Product Name', 'correlation-scatter-plot-chart'],
  [
    'scatter plot of Sales vs Profit by Product Name with trend line',
    'correlation-scatter-trendline-chart',
  ],
  ['symbol map of Sales by State/Province', 'spatial-symbol-map'],
  ['treemap of Sales by Category and Sub-Category', 'part-to-whole-treemap-chart'],
  ['pie chart of Sales by Segment', 'part-to-whole-pie-chart'],
  ['quota attainment bullet of Sales by Segment', 'quota-attainment-bullet'],
  ['slope chart of Sales by Region over Order Date', 'slope-chart'],
  ['filled map of Profit by State/Province', 'spatial-choropleth-map'],
  ['filled map of Profit by State/Province and Country/Region', 'spatial-choropleth-map'],
  [
    'bubble chart of Sales versus Profit by Product Name sized by Quantity',
    'correlation-bubble-chart',
  ],
];

// ── KNOWN SAFE-PROPOSES (NOT bound — fail-closed by design; WHY each) ──────────
const SAFE_PROPOSES: ReadonlyArray<readonly [ask: string, why: string]> = [
  [
    'grouped bar chart of Sales by Category',
    'the specific grouped-bar winner cannot fill its series slot and must not fall back to a generic bar',
  ],
  [
    'symbol map of Sales by Country and State',
    'a neutral geo slot cannot choose between two requested geo concepts',
  ],
  [
    'symbol map of Sales by Country, State, and City',
    'a neutral geo slot must not accept one exact match while ignoring two other requested geo concepts',
  ],
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
    'runtime binder reuses the named Sub-Category for both required categorical slots',
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
    'magnitude chart of Sales by Category',
    'magnitude-simple-bar',
    'pinned-current-behavior: magnitude intent + Sales + Category fill the simple magnitude bar slots',
  ],
];

// Pinned NOT-BOUND (propose → assert not-bound):
const PINNED_PROPOSE: ReadonlyArray<readonly [ask: string, note: string]> = [
  [
    'waterfall of Profit by Sub-Category',
    'runtime descriptor requires the measure at both sum and none derivations; automatic binding does not duplicate it',
  ],
  [
    'connected scatterplot of Profit vs Sales by Customer Name and Region',
    'runtime descriptor requires one measure at both sum and none derivations',
  ],
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
  [
    'bubble chart of Sales versus Profit by Product Name sized by Quantity and Discount',
    'two competing size measures stay on the proposal path',
  ],
  [
    'dot strip plot of Sales by Sub-Category over Order Date',
    'pinned-current-behavior: W63 stamp made ranking-dot-strip-plot eligible, but its rows slot needs a MONTH-derivation temporal (deriv=mn) that this phrasing does not fill deterministically → propose (fail-open to the LLM path)',
  ],
  // The filled-map cases live in ONE_SHOTS: runtime semantic roles distinguish the neutral
  // field_base_N slots, and the required country slot auto-completes when state is ask-named.
  // The distribution-bar-code strip-plot case above stays here because its ask names no geo
  // field, so no geo slot is ask-satisfied and completion remains fail-closed.
];

describe('binder/bind-behavior-matrix — fixture contract', () => {
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

  it('maps an explicit bubble request without swapping axes or dropping size', async () => {
    const res = await bind('bubble chart of Sales versus Profit by Product Name sized by Quantity');
    expect(res.status).toBe('bound');
    if (res.status !== 'bound') return;
    expect(res.used_llm).toBe(false);
    expect(res.args.field_mapping).toEqual({
      '{{field_base_1}}': '[Sample - Superstore].[avg:Profit:qk]',
      '{{field_base_2}}': '[Sample - Superstore].[sum:Sales:qk]',
      '{{field_base_3}}': '[Sample - Superstore].[sum:Quantity:qk]',
      '{{field_base_4}}': '[Sample - Superstore].[none:Product Name:nk]',
    });
  });

  it.each([
    [
      'grouped bar chart of Sales by Category and Region',
      {
        '{{field_base_1}}': '[Sample - Superstore].[none:Category:nk]',
        '{{field_base_2}}': '[Sample - Superstore].[none:Region:nk]',
        '{{field_base_3}}': '[Sample - Superstore].[sum:Sales:qk]',
      },
    ],
    [
      'line chart of Sales over Order Date by Category',
      {
        '{{field_base_1}}': '[Sample - Superstore].[sum:Sales:qk]',
        '{{field_base_2}}': '[Sample - Superstore].[tmn:Order Date:qk]',
        '{{field_base_3}}': '[Sample - Superstore].[none:Category:nk]',
      },
    ],
    [
      'scatter plot of Sales vs Profit by Product Name with trend line',
      {
        '{{field_base_1}}': '[Sample - Superstore].[sum:Sales:qk]',
        '{{field_base_2}}': '[Sample - Superstore].[sum:Profit:qk]',
        '{{field_base_3}}': '[Sample - Superstore].[none:Product Name:nk]',
      },
    ],
    [
      'symbol map of Sales by State/Province',
      {
        '{{field_base_1}}': '[Sample - Superstore].[sum:Sales:qk]',
        '{{field_base_2}}': '[Sample - Superstore].[none:State/Province:nk]',
      },
    ],
  ] as const)('maps the must-demo contract for %s', async (ask, expectedMapping) => {
    const res = await bind(ask);
    expect(res.status, JSON.stringify(res)).toBe('bound');
    if (res.status === 'bound') expect(res.args.field_mapping).toEqual(expectedMapping);
  });

  it.each(['Country/Region', 'State/Province', 'City'])(
    'binds the generic symbol-map geo slot to target semantic role %s',
    async (geoField) => {
      const res = await bind(`symbol map of Sales by ${geoField}`);
      expect(res.status, JSON.stringify(res)).toBe('bound');
      if (res.status !== 'bound') return;
      expect(res.args.template_name).toBe('spatial-symbol-map');
      expect(res.args.field_mapping['{{field_base_2}}']).toBe(
        `[Sample - Superstore].[none:${geoField}:nk]`,
      );
    },
  );

  it.each([
    ['Country', 'Country/Region'],
    ['State', 'State/Province'],
  ])('resolves generic geo synonym %s through target field %s', async (askGeo, targetField) => {
    const res = await bind(`symbol map of Sales by ${askGeo}`);
    expect(res.status, JSON.stringify(res)).toBe('bound');
    if (res.status !== 'bound') return;
    expect(res.args.template_name).toBe('spatial-symbol-map');
    expect(res.args.field_mapping['{{field_base_2}}']).toBe(
      `[Sample - Superstore].[none:${targetField}:nk]`,
    );
  });
});

describe('binder/bind-behavior-matrix — KNOWN safe-proposes (fail-closed by design)', () => {
  it.each(SAFE_PROPOSES)('%s → NOT bound (%s)', async (ask) => {
    const res = await bind(ask);
    expect(res.status, `${ask} must fail closed (not bound)`).not.toBe('bound');
  });
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
