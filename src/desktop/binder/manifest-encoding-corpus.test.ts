import fs from 'fs';
import path from 'path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { bindTemplate, classifyNoLlm, summarizeSchema } from './binder.js';
import { hasDeterministicPathBlockingHazard } from './classify.js';
import { loadManifests } from './manifest.js';
import type { SlotSpec, TemplateManifest } from './manifest-types.js';

// MANIFEST × ENCODING-INTENT CORPUS — the whole-corpus lock on what the deterministic
// classifier binds (Miller backlog item 4).
//
// WHY THIS EXISTS. Studio v10 shipped MCP 2.46.0 and built a symbol map that was missing
// the colour and tooltip encodings the user asked for. PR #635 added the optional `color`
// and `tooltip` slots to the two symbol-map manifests plus a natural-cue matcher ("warmer"
// -> colour, "hover" -> tooltip). Until now that whole surface was pinned by ONE file
// (symbolMapEncodings.test.ts, 11 cases) covering TWO of the 44 manifests. A manifest edit
// anywhere else could delete an optional slot, or a classifier edit could stop filling one,
// and CI would stay green.
//
// This suite drives EVERY manifest against a fixed set of encoding intents through
// classifyNoLlm and holds three different kinds of line:
//
//   1. DERIVED INVARIANTS over the full matrix (§matrix). Nothing is hand-recorded: each
//      assertion is computed from the selected manifest itself, so it stays true as the
//      corpus grows. These are the ones that catch a dropped slot.
//   2. DECLARED VERDICTS for each manifest's plain ask (§plain). Hand-authored with a
//      stated reason, so a wrong routing fails instead of being re-recorded.
//   3. THE OPTIONAL-SLOT TABLE (§optional). One row per optional bindable slot in the
//      corpus, with the ask that must fill it and the ask that must leave it alone. A
//      coverage tripwire fails when a manifest gains an optional slot with no row, so a
//      new slot cannot ship untested.
//
// Cases whose correct behaviour we cannot honestly state are labelled
// `characterisation-only` and say so in the row; they assert only that the classifier does
// not silently bind something else.
//
// Fully offline: manifests + committed/inline XML, no Tableau, no network, no model.

const SUPERSTORE = fs.readFileSync(
  path.join(process.cwd(), 'src', 'desktop', 'binder', 'fixtures', 'superstore-scratch-ref.xml'),
  'utf8',
);

/**
 * Coordinate schema for spatial-symbol-map-latlon, whose required slots are Latitude /
 * Longitude / a detail dimension — none of which Superstore carries. Carries the same
 * `Quantity` measure and `Ship Mode` dimension the shared cue suffixes name, so one intent
 * list drives both schemas.
 */
const POINTS = `<?xml version='1.0'?>
<workbook><datasources><datasource name='Points'>
  <column name='[Country]' role='dimension' type='nominal' datatype='string' semantic-role='[Country].[Name]' />
  <column name='[Ship Mode]' role='dimension' type='nominal' datatype='string' />
  <column name='[Latitude]' role='measure' type='quantitative' datatype='real' />
  <column name='[Longitude]' role='measure' type='quantitative' datatype='real' />
  <column name='[Visits]' role='measure' type='quantitative' datatype='integer' />
  <column name='[Quantity]' role='measure' type='quantitative' datatype='integer' />
</datasource></datasources></workbook>`;

/** Same as POINTS with a single dimension, so nothing is left over to auto-fill `detail2`. */
const POINTS_ONE_DIM = `<?xml version='1.0'?>
<workbook><datasources><datasource name='Points'>
  <column name='[Country]' role='dimension' type='nominal' datatype='string' semantic-role='[Country].[Name]' />
  <column name='[Latitude]' role='measure' type='quantitative' datatype='real' />
  <column name='[Longitude]' role='measure' type='quantitative' datatype='real' />
</datasource></datasources></workbook>`;

/**
 * Exactly ONE spare categorical after the required slots bind — the only shape in which
 * `colorSeriesBinding` fills trend-line-chart's optional `color_series` slot (it refuses to
 * pick a series when two or more candidates remain).
 */
const NARROW = `<?xml version='1.0'?>
<workbook><datasources><datasource name='Narrow'>
  <column name='[Order Date]' role='dimension' type='quantitative' datatype='date' />
  <column name='[Region]' role='dimension' type='nominal' datatype='string' />
  <column name='[Sales]' role='measure' type='quantitative' datatype='real' />
</datasource></datasources></workbook>`;

const SINGLE_DATE = `<?xml version='1.0'?>
<workbook><datasources><datasource name='SingleDate'>
  <column name='[Order Date]' role='dimension' type='quantitative' datatype='date' />
  <column name='[Sales]' role='measure' type='quantitative' datatype='real' />
</datasource></datasources></workbook>`;

const TWO_DATES = `<?xml version='1.0'?>
<workbook><datasources><datasource name='TwoDates'>
  <column name='[Order Date]' role='dimension' type='quantitative' datatype='date' />
  <column name='[Ship Date]' role='dimension' type='quantitative' datatype='datetime' />
  <column name='[Sales]' role='measure' type='quantitative' datatype='real' />
</datasource></datasources></workbook>`;

function businessSynonymSchema(measures: readonly string[], dimension = 'Region'): string {
  const columns = [
    `<column name='[${dimension}]' role='dimension' type='nominal' datatype='string' />`,
    ...measures.map(
      (measure) =>
        `<column name='[${measure}]' role='measure' type='quantitative' datatype='real' />`,
    ),
  ];
  return `<?xml version='1.0'?><workbook><datasources><datasource name='BusinessSynonyms'>
  ${columns.join('\n  ')}
</datasource></datasources></workbook>`;
}

function classifierSchema(
  measures: readonly string[],
  dimensions: readonly string[],
  calculatedMeasures: readonly string[] = [],
): string {
  const columns = [
    ...dimensions.map(
      (dimension) =>
        `<column name='[${dimension}]' role='dimension' type='nominal' datatype='string' />`,
    ),
    ...measures.map(
      (measure) =>
        `<column name='[${measure}]' role='measure' type='quantitative' datatype='real' />`,
    ),
    ...calculatedMeasures.map(
      (measure, index) =>
        `<column caption='${measure}' name='[Calculation_${index + 1}]' role='measure' type='quantitative' datatype='real'><calculation class='tableau' formula='1' /></column>`,
    ),
  ];
  return `<?xml version='1.0'?><workbook><datasources><datasource name='Classifier'>
  ${columns.join('\n  ')}
</datasource></datasources></workbook>`;
}

/**
 * One geo level (country) plus a NON-geographic spare dimension. This is the schema in which
 * the optional geo slots (`state`, `city`) can honestly be shown to stay unbound: Superstore
 * cannot do it, because "by Country/Region" substring-matches its separate, non-geographic
 * [Region] field and that field lands in the optional state slot (pinned below as a
 * suspected defect).
 */
const GEO_MINIMAL = `<?xml version='1.0'?>
<workbook><datasources><datasource name='GeoMin'>
  <column name='[Country/Region]' role='dimension' type='nominal' datatype='string' semantic-role='[Country].[ISO3166_2]' />
  <column name='[Segment]' role='dimension' type='nominal' datatype='string' />
  <column name='[Sales]' role='measure' type='quantitative' datatype='real' />
  <column name='[Profit]' role='measure' type='quantitative' datatype='real' />
</datasource></datasources></workbook>`;

type SchemaId = 'superstore' | 'points' | 'points-one-dim' | 'narrow' | 'geo-minimal';

const SCHEMA_XML: Readonly<Record<SchemaId, string>> = {
  superstore: SUPERSTORE,
  points: POINTS,
  'points-one-dim': POINTS_ONE_DIM,
  narrow: NARROW,
  'geo-minimal': GEO_MINIMAL,
};

/**
 * The encoding intents. Each is a suffix appended to a manifest's plain ask, so every case
 * differs from its baseline by the cue alone.
 *
 * The seven the backlog named are here (plain, size, colour/"warmer", tooltip/"hover",
 * detail, sort, top-N). Two more earn their place:
 *   • `color-explicit` — "Put X on Color." is the case where a dropped colour slot is
 *     unambiguously wrong: the user named the shelf AND the field. The natural "warmer" cue
 *     is deliberately softer (it may legitimately reuse the size measure or fill nothing),
 *     so on its own it is a weak drop-detector.
 *   • `facet` — without a small-multiples cue, four of the corpus's optional bindable slots
 *     (box-plot `facet`, ranking-ordered-bar `facet_row`, trend-line `facet_col`, and by
 *     exclusion `color_series`) are never exercised, and the claim "no slot can be silently
 *     dropped" would be false for them.
 *
 * Every cue names `Quantity` (a measure) or `Ship Mode` (a dimension). Neither appears in
 * any plain ask below, so a cue-bound field is always attributable to the cue.
 */
const INTENTS: ReadonlyArray<readonly [intent: string, suffix: string]> = [
  ['plain', ''],
  ['size', ', sized by Quantity'],
  ['color-natural', ', with warmer colours where Quantity is higher'],
  ['color-explicit', '. Put Quantity on Color.'],
  ['tooltip-natural', ', and show me the details when I hover over a mark'],
  ['detail', ', with Ship Mode for detail'],
  ['facet', ', small multiples per Ship Mode'],
  ['sort', ', sorted descending'],
  ['top-n', ', top 5'],
];

/**
 * What the PLAIN ask must do. `slots` is the exact set of slot_ids that must bind — stated
 * up front so a changed binding fails the test instead of being re-recorded.
 *   • `binds`            — routes to its own manifest; this is the expected slot set and why.
 *   • `routes-elsewhere` — routes to a DIFFERENT template on purpose; names it and why.
 *   • `fails-closed`     — classifyNoLlm must return null (escalate to the LLM propose path).
 * `characterisation` marks a row whose correct behaviour we cannot honestly assert; it still
 * pins the outcome so a silent change to a WRONG bind is caught.
 */
type PlainVerdict =
  | { kind: 'binds'; slots: readonly string[]; why: string; characterisation?: true }
  | {
      kind: 'routes-elsewhere';
      template: string;
      slots: readonly string[];
      why: string;
      characterisation?: true;
    }
  | { kind: 'fails-closed'; why: string; characterisation?: true };

interface CorpusRow {
  /** The manifest this row targets. */
  template: string;
  /** A natural ask built from that manifest's own intent keywords and the schema's fields. */
  ask: string;
  schema: SchemaId;
  plain: PlainVerdict;
}

// One row per manifest. The `why` on each verdict is the load-bearing part: it says what
// correct means, so a future diff has to argue with the reason rather than re-record the
// output. Reasons that were already established and explained by
// bind-behavior-matrix.invariant.test.ts are cited rather than re-derived.
const CORPUS: readonly CorpusRow[] = [
  {
    template: 'box-plot-chart',
    ask: 'box plot of Sales by Region',
    schema: 'superstore',
    plain: {
      kind: 'binds',
      slots: ['measure', 'level'],
      why: 'both required slots (quantitative measure + categorical level) are ask-named; the optional facet slot needs a small-multiples cue this ask does not carry',
    },
  },
  {
    template: 'bullet-variance-chart',
    ask: 'bullet variance chart of Sales against Profit by Region',
    schema: 'superstore',
    plain: {
      kind: 'fails-closed',
      why: 'not fast_path_eligible (readiness YELLOW, render_verified none) — the deterministic classifier only ever selects render-verified templates',
    },
  },
  {
    template: 'change-over-time-area-chart',
    ask: 'area chart of Sales by Order Date and Region',
    schema: 'superstore',
    plain: {
      kind: 'fails-closed',
      why: 'not fast_path_eligible (readiness YELLOW, render_verified none)',
    },
  },
  {
    template: 'change-over-time-calendar-heatmap',
    ask: 'calendar heatmap of Sales by Order Date',
    schema: 'superstore',
    plain: {
      kind: 'fails-closed',
      why: 'not fast_path_eligible (readiness YELLOW, render_verified none)',
    },
  },
  {
    template: 'change-over-time-stacked-area-chart',
    ask: 'stacked area chart of Sales by Order Date and Region',
    schema: 'superstore',
    plain: {
      kind: 'fails-closed',
      why: 'not fast_path_eligible (readiness YELLOW, render_verified none)',
    },
  },
  {
    template: 'connected-scatterplot',
    ask: 'connected scatterplot of Profit vs Sales by Customer Name and Region',
    schema: 'superstore',
    plain: {
      kind: 'binds',
      slots: ['sales', 'profit', 'region', 'customer_name'],
      why: 'the same one-shot bind-behavior-matrix.invariant.test.ts pins: two measures + a detail dim + a colour dim fill all four required slots',
    },
  },
  {
    template: 'control-chart-xmr',
    ask: 'control chart of Profit by Order Date',
    schema: 'superstore',
    plain: {
      kind: 'fails-closed',
      characterisation: true,
      why: 'characterisation-only: eligible, but the classifier proposes on this phrasing (same pin as bind-behavior-matrix.invariant.test.ts PINNED_PROPOSE). A second phrasing ("xmr process control chart of Profit over Order Date") also fails closed, so this is not a wording accident — but we cannot state which binding would be correct',
    },
  },
  {
    template: 'correlation-bubble-chart',
    ask: 'bubble chart of Profit, Discount, and Sales by Order ID',
    schema: 'superstore',
    plain: {
      kind: 'fails-closed',
      characterisation: true,
      why: 'characterisation-only: eligible, but the classifier proposes on this phrasing (same pin as bind-behavior-matrix.invariant.test.ts PINNED_PROPOSE); an explicit "sized scatter ... sized by Discount" phrasing does bind, so the gap is in routing, not in the slots',
    },
  },
  {
    template: 'correlation-dual-axis-chart',
    ask: 'dual axis chart of Profit and Discount by Order Date',
    schema: 'superstore',
    plain: {
      kind: 'fails-closed',
      why: 'not fast_path_eligible (readiness GREEN but render_verified none — the completing proof is missing)',
    },
  },
  {
    template: 'correlation-highlight-table',
    ask: 'highlight table of Sales and Profit by Segment and Order Date',
    schema: 'superstore',
    plain: {
      kind: 'fails-closed',
      why: 'not fast_path_eligible — HARDCODED_FILTER_MEMBERS blocker',
    },
  },
  {
    template: 'correlation-scatter-plot-chart',
    ask: 'scatter plot of Profit and Sales by Customer Name and Region',
    schema: 'superstore',
    plain: {
      kind: 'binds',
      slots: ['sales', 'profit', 'customer_name', 'region'],
      why: 'the full-phrasing one-shot pinned by bind-behavior-matrix.invariant.test.ts: two measures + two categoricals fill all four required slots',
    },
  },
  {
    template: 'deviation-arrow',
    ask: 'deviation arrow chart of Sales against Profit by Region',
    schema: 'superstore',
    plain: {
      kind: 'fails-closed',
      why: 'not fast_path_eligible (readiness GREEN but render_verified none)',
    },
  },
  {
    template: 'deviation-diverging-bar',
    ask: 'diverging bar chart of Profit and Sales by Sub-Category',
    schema: 'superstore',
    plain: {
      kind: 'routes-elsewhere',
      template: 'ranking-ordered-bar',
      slots: ['region', 'sales'],
      characterisation: true,
      why: 'characterisation-only: the template is ineligible so it can never be selected, and the "bar" noun carries the ask to the eligible ranking bar. A ranked bar of Profit by Sub-Category is a defensible answer to this ask, but it is not the diverging bar the user asked for; what matters here is that it fails to an eligible, render-verified template rather than binding an unproven one',
    },
  },
  {
    template: 'deviation-gain-loss-chart',
    ask: 'gain-loss chart of Sales by Sub-Category over Order Date',
    schema: 'superstore',
    plain: {
      kind: 'fails-closed',
      why: 'not fast_path_eligible (readiness YELLOW, render_verified none)',
    },
  },
  {
    template: 'deviation-spine-chart',
    ask: 'spine chart of Region',
    schema: 'superstore',
    plain: {
      kind: 'fails-closed',
      why: 'not fast_path_eligible — NO_DATASOURCE_PLACEHOLDER + DATASET_SPECIFIC_FORMULA blockers',
    },
  },
  {
    template: 'distribution-bar-code-chart',
    ask: 'bar code chart of Sales by Sub-Category, Country/Region and State/Province',
    schema: 'superstore',
    plain: {
      kind: 'binds',
      slots: ['sub_category', 'sales', 'country_region', 'state_province'],
      why: 'this template requires TWO geo slots on top of the dim + measure; the ask names both, which is exactly the case bind-behavior-matrix pins as failing closed when they are omitted',
    },
  },
  {
    template: 'distribution-histogram',
    ask: 'histogram of Sales',
    schema: 'superstore',
    plain: {
      kind: 'fails-closed',
      why: 'not fast_path_eligible — DATASET_SPECIFIC_FORMULA blocker',
    },
  },
  {
    template: 'funnel-chart',
    ask: 'funnel chart of Sales by Segment',
    schema: 'superstore',
    plain: {
      kind: 'binds',
      slots: ['stage', 'amount'],
      why: 'stage=Segment + amount=Sales fill the two required slots (same pin as bind-behavior-matrix)',
    },
  },
  {
    template: 'gantt-chart',
    ask: 'gantt chart of Category, Sub-Category, Product Name and Order ID by Order Date and Ship Date',
    schema: 'superstore',
    plain: {
      kind: 'fails-closed',
      why: 'not fast_path_eligible (readiness YELLOW, render_verified none)',
    },
  },
  {
    template: 'gantt-task-rollup-chart',
    ask: 'gantt task rollup of Discount by Product Name and Category over Order Date',
    schema: 'superstore',
    plain: {
      kind: 'binds',
      slots: ['task', 'start_date', 'duration', 'phase'],
      why: 'all four required slots are ask-named (two categoricals + a temporal + a measure); bind-behavior-matrix pins the same template failing closed when the temporal/duration slots are absent',
    },
  },
  {
    template: 'gantt-timeline-chart',
    ask: 'gantt timeline of Discount by Product Name and Category over Order Date',
    schema: 'superstore',
    plain: {
      kind: 'routes-elsewhere',
      template: 'trend-line-chart',
      slots: ['order_date', 'sales'],
      characterisation: true,
      why: 'characterisation-only: ineligible (readiness YELLOW), and "timeline" is a trend-line-chart intent keyword, so the ask lands on the eligible time-series template. A line of Discount over Order Date is not the project timeline asked for; pinned so a change here is deliberate',
    },
  },
  {
    template: 'kpi-text',
    ask: 'kpi of Sales',
    schema: 'superstore',
    plain: {
      kind: 'binds',
      slots: ['value'],
      why: 'a single required quantitative slot, ask-named',
    },
  },
  {
    template: 'magnitude-paired-bar',
    ask: 'paired bar chart of Sales by Region over Order Date',
    schema: 'superstore',
    plain: {
      kind: 'routes-elsewhere',
      template: 'ranking-ordered-bar',
      slots: ['region', 'sales'],
      characterisation: true,
      why: 'characterisation-only: ineligible (HARDCODED_FILTER_MEMBERS blocker), so the "bar" noun carries it to the eligible ranking bar and the Order Date half of the ask is dropped',
    },
  },
  {
    template: 'magnitude-paired-column-chart',
    ask: 'paired column chart of Sales by Region over Order Date',
    schema: 'superstore',
    plain: {
      kind: 'routes-elsewhere',
      template: 'ranking-ordered-column',
      slots: ['region', 'sales'],
      characterisation: true,
      why: 'characterisation-only: ineligible (HARDCODED_FILTER_MEMBERS blocker); the "column" noun routes it to the eligible ordered-column sibling',
    },
  },
  {
    template: 'magnitude-simple-bar',
    ask: 'magnitude chart of Sales by Category',
    schema: 'superstore',
    plain: {
      kind: 'binds',
      slots: ['category', 'measure'],
      why: 'the magnitude intent keyword plus one categorical and one measure fill both required slots (same pin as bind-behavior-matrix)',
    },
  },
  {
    template: 'pareto-chart',
    ask: 'pareto chart of Sales by Sub-Category',
    schema: 'superstore',
    plain: { kind: 'fails-closed', why: 'not fast_path_eligible — PARAMETER_REQUIRED blocker' },
  },
  {
    template: 'part-to-whole-pie-chart',
    ask: 'pie chart of Sales by Segment',
    schema: 'superstore',
    plain: {
      kind: 'binds',
      slots: ['region', 'sales'],
      why: 'one categorical + one measure fill both required slots',
    },
  },
  {
    template: 'part-to-whole-proportional-stacked-bar',
    ask: 'proportional stacked bar of Sales by Region and Category',
    schema: 'superstore',
    plain: {
      kind: 'routes-elsewhere',
      template: 'part-to-whole-stacked-bar-chart',
      slots: ['region', 'sales', 'category'],
      why: 'ineligible (readiness YELLOW), and the eligible stacked-bar sibling shares the slot shape, so the ask lands on the render-verified template of the same family — the percent-of-total treatment is what is lost',
    },
  },
  {
    template: 'part-to-whole-stacked-bar-chart',
    ask: 'stacked bar of Sales by Category and Sub-Category',
    schema: 'superstore',
    plain: {
      kind: 'binds',
      slots: ['region', 'sales', 'category'],
      why: 'two categoricals + one measure fill the three required slots (slot_ids are Superstore-flavoured names, not a claim about the fields bound)',
    },
  },
  {
    template: 'part-to-whole-treemap-chart',
    ask: 'treemap of Sales by Category and Sub-Category',
    schema: 'superstore',
    plain: {
      kind: 'binds',
      slots: ['category', 'sales', 'sub_category'],
      why: 'two categoricals + one measure fill the three required slots',
    },
  },
  {
    template: 'part-to-whole-waterfall',
    ask: 'waterfall of Profit by Sub-Category',
    schema: 'superstore',
    plain: {
      kind: 'binds',
      slots: ['profit', 'sub_category'],
      why: 'both required slots are ask-named. The optional anchor_category slot is NOT filled here by design — it is auto-defaulted downstream in bindTemplate (see §optional and binder.test.ts "waterfall DEFAULTS anchor_category")',
    },
  },
  {
    template: 'quota-attainment-bullet',
    ask: 'bullet chart of Sales versus quota Profit by Segment',
    schema: 'superstore',
    plain: {
      kind: 'binds',
      slots: ['entity', 'actual', 'quota'],
      why: "this template needs TWO measures plus an entity; the ask names both measures and marks which is the quota, which is what bind-behavior-matrix's single-measure phrasing lacks when it fails closed",
    },
  },
  {
    template: 'ranking-bump-chart',
    ask: 'bump chart of Sales by Sub-Category over Order Date',
    schema: 'superstore',
    plain: {
      kind: 'fails-closed',
      why: 'not fast_path_eligible (readiness YELLOW, render_verified none)',
    },
  },
  {
    template: 'ranking-dot-strip-plot',
    ask: 'dot strip plot of Sales by Sub-Category over Order Date',
    schema: 'superstore',
    plain: {
      kind: 'fails-closed',
      characterisation: true,
      why: 'characterisation-only: eligible, but its rows slot needs a Month-derivation temporal that this phrasing does not fill deterministically (same pin and reason as bind-behavior-matrix PINNED_PROPOSE)',
    },
  },
  {
    template: 'ranking-ordered-bar',
    ask: 'bar chart of Sales by Sub-Category',
    schema: 'superstore',
    plain: {
      kind: 'binds',
      slots: ['region', 'sales'],
      why: 'the canonical one-shot; the optional facet_row slot stays unbound without a small-multiples cue',
    },
  },
  {
    template: 'ranking-ordered-column',
    ask: 'column chart of Sales by Sub-Category',
    schema: 'superstore',
    plain: {
      kind: 'binds',
      slots: ['region', 'sales'],
      why: "the distinct 'column' chart noun selects the ordered-column sibling",
    },
  },
  {
    template: 'slope-chart',
    ask: 'slope chart of Sales by Region over Order Date',
    schema: 'superstore',
    plain: {
      kind: 'binds',
      slots: ['region', 'profit', 'order_date'],
      why: "the 'slope' chart noun plus a measure, a dimension and a temporal fill the three required slots",
    },
  },
  {
    template: 'spatial-choropleth-map',
    ask: 'filled map of Profit by State/Province',
    schema: 'superstore',
    plain: {
      kind: 'binds',
      slots: ['country', 'state', 'profit'],
      why: 'the required country slot has no ask-named candidate so it widens to the schema and picks the unique country-affine field; the optional state slot fills from the ask-named State/Province',
    },
  },
  {
    template: 'spatial-symbol-map-latlon',
    ask: 'symbol map using Latitude and Longitude with Country for detail',
    schema: 'points',
    plain: {
      kind: 'binds',
      slots: ['longitude', 'latitude', 'detail1', 'detail2'],
      why: 'the coordinate resolver fills the two axes plus detail1=Country, then completes the optional detail2 from the one spare dimension. size/color/tooltip stay unbound: the ask carries no encoding cue and names no measure',
    },
  },
  {
    template: 'spatial-symbol-map',
    ask: 'symbol map of Sales by Country/Region, State/Province, and City',
    schema: 'superstore',
    plain: {
      kind: 'binds',
      slots: ['country', 'state', 'city', 'sales'],
      why: 'the required geo + measure slots bind, and the optional state/city slots fill because the ask names them. color and tooltip must NOT bind — this is the 2.46.0 baseline: no cue, no encoding',
    },
  },
  {
    template: 'trend-line-chart',
    ask: 'line chart of Sales by Order Date',
    schema: 'superstore',
    plain: {
      kind: 'binds',
      slots: ['order_date', 'sales'],
      why: 'temporal + measure fill both required slots; facet_col needs a small-multiples cue and color_series needs exactly one spare categorical, of which Superstore has many',
    },
  },
  {
    template: 'ww-floating-bars',
    ask: 'floating bar chart of Sales by Region and Sub-Category',
    schema: 'superstore',
    plain: {
      kind: 'routes-elsewhere',
      template: 'ranking-ordered-bar',
      slots: ['region', 'sales'],
      characterisation: true,
      why: 'characterisation-only: ineligible AND carrying the compound-string-parse hazard, so it can never be selected; the "bar" noun carries the ask to the eligible ranking bar',
    },
  },
  {
    template: 'ww-ou-arrow',
    ask: 'over-under arrow chart of Sales by Sub-Category',
    schema: 'superstore',
    plain: {
      kind: 'fails-closed',
      why: 'eligible, but demoted unconditionally by the compound-string-parse hazard: its calcs SPLIT a sports-score string out of a bound field, a risk that lives in the data and is invisible to any ask. Asserted directly against hasDeterministicPathBlockingHazard below',
    },
  },
  {
    template: 'ww-ou-diff',
    ask: 'over-under diff chart of Sales by Sub-Category',
    schema: 'superstore',
    plain: {
      kind: 'fails-closed',
      why: 'not fast_path_eligible (readiness YELLOW) AND compound-string-parse hazard-blocked',
    },
  },
];

/**
 * Every OPTIONAL bindable slot in the corpus, with the ask that must fill it and the ask
 * that must leave it alone. This is the direct answer to the 2.46.0 failure: a manifest
 * edit that deletes a slot, or a classifier edit that stops filling one, breaks the `fills`
 * half; a cue matcher that grows too greedy breaks the `staysUnbound` half.
 *
 * `unreachable` marks a slot classifyNoLlm cannot fill at all, with where it IS filled — an
 * honest statement beats a green row that proves nothing.
 */
interface FillCase {
  ask: string;
  schema: SchemaId;
  field: string;
  why: string;
}

interface OptionalSlotRow {
  template: string;
  slot: string;
  fills: FillCase | { unreachable: true; why: string };
  /** Extra asks that must also reach the slot — a second, independent route into it. */
  alsoFills?: readonly FillCase[];
  staysUnbound: { ask: string; schema: SchemaId; why: string };
}

const OPTIONAL_SLOTS: readonly OptionalSlotRow[] = [
  {
    template: 'box-plot-chart',
    slot: 'facet',
    fills: {
      ask: 'box plot of Sales by Region, small multiples per Segment',
      schema: 'superstore',
      field: 'Segment',
      why: 'the small-multiples cue plus one spare ask-named categorical is exactly what facetBinding requires',
    },
    staysUnbound: {
      ask: 'box plot of Sales by Region',
      schema: 'superstore',
      why: 'no facet cue — the augmentation is opt-in and must leave a plain ask byte-unchanged',
    },
  },
  {
    template: 'ranking-ordered-bar',
    slot: 'facet_row',
    fills: {
      ask: 'bar chart of Sales by Region, small multiples per Segment',
      schema: 'superstore',
      field: 'Segment',
      why: "same facet augmentation, into this manifest's row-oriented facet slot",
    },
    staysUnbound: {
      ask: 'bar chart of Sales by Region',
      schema: 'superstore',
      why: 'no facet cue',
    },
  },
  {
    template: 'trend-line-chart',
    slot: 'facet_col',
    fills: {
      ask: 'line chart of Sales by Order Date, small multiples per Segment',
      schema: 'superstore',
      field: 'Segment',
      why: "same facet augmentation, into this manifest's column-oriented facet slot",
    },
    staysUnbound: {
      ask: 'line chart of Sales by Order Date',
      schema: 'superstore',
      why: 'no facet cue',
    },
  },
  {
    template: 'trend-line-chart',
    slot: 'color_series',
    fills: {
      ask: 'line chart of Sales by Order Date',
      schema: 'narrow',
      field: 'Region',
      why: 'colorSeriesBinding needs NO cue — it fills when exactly one categorical is left unconsumed, which only the narrow schema gives. Note the asymmetry with facet_col: a "one line per Region" phrasing hits the facet cue ("per") first and binds facet_col instead',
    },
    staysUnbound: {
      ask: 'line chart of Sales by Order Date',
      schema: 'superstore',
      why: 'Superstore leaves many spare categoricals, and the binding refuses to pick a series arbitrarily',
    },
  },
  {
    template: 'part-to-whole-waterfall',
    slot: 'anchor_category',
    fills: {
      unreachable: true,
      why: 'classifyNoLlm never fills this slot. It is auto-defaulted later, inside bindTemplate, from a detected row-type column (binder.ts WATERFALL_ANCHOR_SLOT_ID; covered by binder.test.ts "waterfall DEFAULTS anchor_category to a row-type column when none is bound"). Recorded here so the corpus census stays complete rather than silently skipping it',
    },
    staysUnbound: {
      ask: 'waterfall of Profit by Sub-Category with Category as the anchor',
      schema: 'superstore',
      why: 'even an ask that names an anchor leaves the slot unbound at classify time — the default is applied downstream',
    },
  },
  {
    template: 'spatial-choropleth-map',
    slot: 'state',
    fills: {
      ask: 'filled map of Profit by State/Province',
      schema: 'superstore',
      field: 'State/Province',
      why: 'the optional sub-region slot fills from the geo field the ask names, while the required country slot widens to the schema',
    },
    staysUnbound: {
      ask: 'filled map of Profit by Country/Region',
      schema: 'geo-minimal',
      why: 'the ask names only the country level and the schema carries no sub-national field, so nothing may reach the optional state slot. Deliberately NOT run on Superstore: see the geo-slot characterisation suite below',
    },
  },
  {
    template: 'spatial-symbol-map',
    slot: 'state',
    fills: {
      ask: 'symbol map of Sales by Country/Region, State/Province, and City',
      schema: 'superstore',
      field: 'State/Province',
      why: 'geo-affinity resolution puts the ask-named state field in the state slot',
    },
    staysUnbound: {
      ask: 'symbol map of Sales by Country/Region',
      schema: 'geo-minimal',
      why: 'no sub-national field exists to reach the optional state slot, and the spare non-geo [Segment] dimension must not be pulled into it. Deliberately NOT run on Superstore: see the geo-slot characterisation suite below',
    },
  },
  {
    template: 'spatial-symbol-map',
    slot: 'city',
    fills: {
      ask: 'symbol map of Sales by Country/Region, State/Province, and City',
      schema: 'superstore',
      field: 'City',
      why: 'geo-affinity resolution puts the ask-named city field in the city slot',
    },
    staysUnbound: {
      ask: 'symbol map of Sales by Country/Region',
      schema: 'geo-minimal',
      why: 'no city-level field exists, and the spare non-geo [Segment] dimension must not be pulled into the optional city slot',
    },
  },
  {
    template: 'spatial-symbol-map',
    slot: 'color',
    fills: {
      ask: 'symbol map of Sales by Country/Region, State/Province, and City. Put Quantity on Color.',
      schema: 'superstore',
      field: 'Quantity',
      why: 'THE #635 REGRESSION LOCK. An explicit shelf directive naming a field must reach the colour slot; 2.46.0 shipped this map flat',
    },
    alsoFills: [
      {
        ask: 'symbol map of Sales by Country/Region, State/Province, and City, coloured by Quantity',
        schema: 'superstore',
        field: 'Quantity',
        why: 'the #635 NATURAL cue half: a "coloured by <field>" clause names the field without naming the shelf, and must reach the same slot',
      },
    ],
    staysUnbound: {
      ask: 'symbol map of Sales by Country/Region, State/Province, and City',
      schema: 'superstore',
      why: 'no colour cue — the encoding is opt-in',
    },
  },
  {
    template: 'spatial-symbol-map',
    slot: 'tooltip',
    fills: {
      ask: 'symbol map of Sales by Country/Region, State/Province, and City. Put Quantity on Tooltip.',
      schema: 'superstore',
      field: 'Quantity',
      why: 'THE #635 REGRESSION LOCK, tooltip half',
    },
    alsoFills: [
      {
        ask: 'symbol map of Sales by Country/Region, State/Province, and City, and show me the details when I hover over a mark',
        schema: 'superstore',
        field: 'Sales',
        why: 'the #635 NATURAL cue half. The hover phrasing names no field, so the tooltip reuses the measure already bound to the mark rather than guessing one — that is the right answer here, and it is why this template fills the tooltip where spatial-symbol-map-latlon (which has no required measure) cannot',
      },
    ],
    staysUnbound: {
      ask: 'symbol map of Sales by Country/Region, State/Province, and City',
      schema: 'superstore',
      why: 'no hover/tooltip cue',
    },
  },
  {
    template: 'spatial-symbol-map-latlon',
    slot: 'detail2',
    fills: {
      ask: 'symbol map using Latitude and Longitude with Country for detail',
      schema: 'points',
      field: 'Ship Mode',
      why: 'the coordinate resolver completes the second detail slot from the one spare dimension in the schema',
    },
    staysUnbound: {
      ask: 'symbol map using Latitude and Longitude with Country for detail',
      schema: 'points-one-dim',
      why: 'the same ask on a schema whose only dimension is already bound to detail1 — nothing is left to complete with, and the resolver must not invent one',
    },
  },
  {
    template: 'spatial-symbol-map-latlon',
    slot: 'size',
    fills: {
      ask: 'symbol map using Latitude and Longitude with Country for detail, sized by Quantity',
      schema: 'points',
      field: 'Quantity',
      why: 'an explicit size directive naming the one spare measure. This template has no required measure slot, so size is the only way a measure reaches the mark',
    },
    staysUnbound: {
      ask: 'symbol map using Latitude and Longitude with Country for detail',
      schema: 'points',
      why: 'no size cue and no measure named beyond the coordinate pair',
    },
  },
  {
    template: 'spatial-symbol-map-latlon',
    slot: 'color',
    fills: {
      ask: 'symbol map using Latitude and Longitude with Country for detail. Put Quantity on Color.',
      schema: 'points',
      field: 'Quantity',
      why: 'THE #635 REGRESSION LOCK on the coordinate symbol map',
    },
    staysUnbound: {
      ask: 'symbol map using Latitude and Longitude with Country for detail',
      schema: 'points',
      why: 'no colour cue',
    },
  },
  {
    template: 'spatial-symbol-map-latlon',
    slot: 'tooltip',
    fills: {
      ask: 'symbol map of Visits using Latitude and Longitude with Country for detail, show me the details when I hover over a dot',
      schema: 'points',
      field: 'Visits',
      why: 'the natural hover cue names no field, so the encoding reuses the measure the ask does name. THE ASK MUST NAME A MEASURE: on this template the same hover cue with no measure in the ask fills nothing, because unlike spatial-symbol-map there is no required measure slot to reuse (see the staysUnbound row)',
    },
    staysUnbound: {
      ask: 'symbol map using Latitude and Longitude with Country for detail, show me the details when I hover over a dot',
      schema: 'points',
      why: 'hover cue present but no measure named and no required measure slot to reuse — filling the tooltip here would mean guessing a field, which the binder refuses',
    },
  },
];

/**
 * Cue-degradation pins. Each ask BINDS without its cue and FAILS CLOSED with it: the added
 * words pull a second template into contention and the classifier declines rather than
 * guess. Failing closed is safe (the LLM propose path picks it up) but it costs the one-shot,
 * so these are pinned to make any movement deliberate: making one bind is an improvement
 * that must delete its row here; making one bind to something ELSE is the bug this catches.
 */
const CUE_DEGRADATION: ReadonlyArray<{
  base: string;
  cued: string;
  schema: SchemaId;
  boundTemplate: string;
  why: string;
}> = [
  {
    base: 'funnel chart of Sales by Segment',
    cued: 'funnel chart of Sales by Segment, sorted descending',
    schema: 'superstore',
    boundTemplate: 'funnel-chart',
    why: '"sorted" is a ranking intent keyword (sorted-bar / sorted-column), so the ranking family ties with the funnel and the cross-family tie fails closed. Verified narrow: "descending" alone still binds the funnel',
  },
  {
    base: 'pie chart of Sales by Segment',
    cued: 'pie chart of Sales by Segment, sorted descending',
    schema: 'superstore',
    boundTemplate: 'part-to-whole-pie-chart',
    why: 'same ranking-keyword contention',
  },
  {
    base: 'waterfall of Profit by Sub-Category',
    cued: 'waterfall of Profit by Sub-Category, sorted descending',
    schema: 'superstore',
    boundTemplate: 'part-to-whole-waterfall',
    why: 'same ranking-keyword contention',
  },
  {
    base: 'magnitude chart of Sales by Category',
    cued: 'magnitude chart of Sales by Category, sorted descending',
    schema: 'superstore',
    boundTemplate: 'magnitude-simple-bar',
    why: 'same ranking-keyword contention',
  },
  {
    base: 'magnitude chart of Sales by Category',
    cued: 'magnitude chart of Sales by Category, top 5',
    schema: 'superstore',
    boundTemplate: 'magnitude-simple-bar',
    why: '"top" is a ranking intent keyword; the ranking bar ties with the magnitude bar',
  },
  {
    base: 'kpi of Sales',
    cued: 'kpi of Sales, top 5',
    schema: 'superstore',
    boundTemplate: 'kpi-text',
    why: 'same "top" contention, from the kpi family',
  },
  {
    base: 'bar chart of Sales by Sub-Category',
    cued: 'bar chart of Sales by Sub-Category, and show me the details when I hover over a mark',
    schema: 'superstore',
    boundTemplate: 'ranking-ordered-bar',
    why: 'the hover phrasing costs the one-shot on a NON-symbol-map template. Verified narrow: the shorter "show the details on hover" still binds, so it is the extra words in this phrasing, not the hover cue itself',
  },
  {
    base: 'filled map of Profit by State/Province',
    cued: 'filled map of Profit by State/Province, sized by Quantity',
    schema: 'superstore',
    boundTemplate: 'spatial-choropleth-map',
    why: 'sizing pulls the proportional-symbol map into contention with the filled map. Note the choropleth declares no size slot at all, so binding it would have meant dropping the request silently — failing closed is the honest outcome',
  },
  {
    base: 'filled map of Profit by State/Province',
    cued: 'filled map of Profit by State/Province. Put Quantity on Color.',
    schema: 'superstore',
    boundTemplate: 'spatial-choropleth-map',
    why: 'same spatial contention. The choropleth has no colour slot (colour IS the required measure), so a bind would have dropped the directive; the softer natural cue ("warmer colours") still binds and is covered in the matrix',
  },
  {
    base: 'connected scatterplot of Profit vs Sales by Customer Name and Region',
    cued: 'connected scatterplot of Profit vs Sales by Customer Name and Region, top 5',
    schema: 'superstore',
    boundTemplate: 'connected-scatterplot',
    why: 'the top-N cue pulls the ranking family into contention with the connected scatterplot',
  },
  {
    base: 'scatter plot of Profit and Sales by Customer Name and Region',
    cued: 'scatter plot of Profit and Sales by Customer Name and Region, top 5',
    schema: 'superstore',
    boundTemplate: 'correlation-scatter-plot-chart',
    why: 'the top-N cue pulls the ranking family into contention with the scatter plot',
  },
  {
    base: 'diverging bar chart of Profit and Sales by Sub-Category',
    cued: 'diverging bar chart of Profit and Sales by Sub-Category, and show me the details when I hover over a mark',
    schema: 'superstore',
    boundTemplate: 'ranking-ordered-bar',
    why: 'the long hover cue makes the existing ranking-bar fallback fail closed',
  },
  {
    base: 'paired bar chart of Sales by Region over Order Date',
    cued: 'paired bar chart of Sales by Region over Order Date, and show me the details when I hover over a mark',
    schema: 'superstore',
    boundTemplate: 'ranking-ordered-bar',
    why: 'the long hover cue makes the existing ranking-bar fallback fail closed',
  },
  {
    base: 'floating bar chart of Sales by Region and Sub-Category',
    cued: 'floating bar chart of Sales by Region and Sub-Category, and show me the details when I hover over a mark',
    schema: 'superstore',
    boundTemplate: 'ranking-ordered-bar',
    why: 'the long hover cue makes the existing ranking-bar fallback fail closed',
  },
];

const REROUTED_CUES: ReadonlyArray<{
  base: string;
  cued: string;
  schema: SchemaId;
  fromTemplate: string;
  toTemplate: string;
  droppedFields: readonly string[];
  why: string;
}> = [
  {
    base: 'scatter plot of Profit and Sales by Customer Name and Region',
    cued: 'scatter plot of Profit and Sales by Customer Name and Region, sized by Quantity',
    schema: 'superstore',
    fromTemplate: 'correlation-scatter-plot-chart',
    toTemplate: 'correlation-bubble-chart',
    droppedFields: ['Region'],
    why: 'the size cue reroutes to the bubble chart and drops the requested Region field',
  },
  {
    base: 'scatter plot of Profit and Sales by Customer Name and Region',
    cued: 'scatter plot of Profit and Sales by Customer Name and Region, with warmer colours where Quantity is higher',
    schema: 'superstore',
    fromTemplate: 'correlation-scatter-plot-chart',
    toTemplate: 'correlation-bubble-chart',
    droppedFields: ['Region'],
    why: 'the natural colour cue reroutes to the bubble chart and drops the requested Region field',
  },
  {
    base: 'scatter plot of Profit and Sales by Customer Name and Region',
    cued: 'scatter plot of Profit and Sales by Customer Name and Region. Put Quantity on Color.',
    schema: 'superstore',
    fromTemplate: 'correlation-scatter-plot-chart',
    toTemplate: 'correlation-bubble-chart',
    droppedFields: ['Region'],
    why: 'the explicit colour cue reroutes to the bubble chart and drops the requested Region field',
  },
  {
    base: 'bar code chart of Sales by Sub-Category, Country/Region and State/Province',
    cued: 'bar code chart of Sales by Sub-Category, Country/Region and State/Province, top 5',
    schema: 'superstore',
    fromTemplate: 'distribution-bar-code-chart',
    toTemplate: 'ranking-ordered-bar',
    droppedFields: ['Country/Region', 'State/Province'],
    why: 'the top-N cue reroutes to the ranking bar and drops both requested geo fields',
  },
  {
    base: 'proportional stacked bar of Sales by Region and Category',
    cued: 'proportional stacked bar of Sales by Region and Category, top 5',
    schema: 'superstore',
    fromTemplate: 'part-to-whole-stacked-bar-chart',
    toTemplate: 'ranking-ordered-bar',
    droppedFields: ['Category'],
    why: 'the top-N cue reroutes to the ranking bar and drops the requested Category field',
  },
  {
    base: 'stacked bar of Sales by Category and Sub-Category',
    cued: 'stacked bar of Sales by Category and Sub-Category, top 5',
    schema: 'superstore',
    fromTemplate: 'part-to-whole-stacked-bar-chart',
    toTemplate: 'ranking-ordered-bar',
    droppedFields: ['Sub-Category'],
    why: 'the top-N cue reroutes to the ranking bar and drops the requested Sub-Category field',
  },
];

let manifests: Map<string, TemplateManifest>;
const summaries = {} as Record<SchemaId, ReturnType<typeof summarizeSchema>>;

beforeAll(() => {
  manifests = loadManifests();
  for (const id of Object.keys(SCHEMA_XML) as SchemaId[]) {
    summaries[id] = summarizeSchema(SCHEMA_XML[id]);
  }
});

beforeEach(() => {
  // A future early return must fail instead of manufacturing another green, assertion-free row.
  expect.hasAssertions();
});

describe('binder/manifest-encoding-corpus — temporal-slot fallback', () => {
  const expectedExplicitDateClassification = {
    template: 'trend-line-chart',
    bindings: [
      { slot_id: 'order_date', field: 'Order Date' },
      { slot_id: 'sales', field: 'Sales' },
    ],
    encodings: { filled: [], unfilled: [] },
  };

  it('binds the only date field when a trend ask names no date field', () => {
    const result = classifyNoLlm('sales over time', manifests, summarizeSchema(SINGLE_DATE));

    expect(result).toEqual({
      ...expectedExplicitDateClassification,
      notes: [
        "Using 'Order Date' for required temporal slot 'order_date' because it is the only date field in the datasource.",
      ],
    });
  });

  it.each([
    'line chart of Sales by date',
    'line chart of Sales by month',
    'line chart of Sales by quarter',
    'line chart of Sales by year',
    'line chart of Sales monthly',
    'line chart of Sales quarterly',
    'line chart of Sales yearly',
    'line chart of Sales daily',
    'line chart of Sales over the last 6 months',
    'line chart of Sales for the last 2 quarters',
    'line chart of Sales across the last 3 years',
  ])('recognizes the temporal cue in "%s"', (ask) => {
    const trend = manifests.get('trend-line-chart')!;
    const result = classifyNoLlm(
      ask,
      new Map([[trend.template, trend]]),
      summarizeSchema(SINGLE_DATE),
    );

    expect(result).not.toBeNull();
    expect(result!.bindings).toContainEqual({ slot_id: 'order_date', field: 'Order Date' });
  });

  it('proposes both date candidates instead of binding either when the choice is material', async () => {
    const result = await bindTemplate({
      ask: 'sales over time',
      workbookXml: TWO_DATES,
      manifests,
    });

    expect(result.status).toBe('propose');
    if (result.status !== 'propose') return;
    expect(
      result.llm_input.candidate_templates
        .find((candidate) => candidate.template === 'trend-line-chart')
        ?.slots.find((slot) => slot.slot_id === 'order_date'),
    ).toMatchObject({ kind: 'temporal', required: true });
    expect(
      result.llm_input.fields
        .filter((field) => field.datatype === 'date' || field.datatype === 'datetime')
        .map((field) => field.name),
    ).toEqual(['Order Date', 'Ship Date']);
  });

  it('keeps an explicitly named date-field classification byte-identical', () => {
    const result = classifyNoLlm(
      'line chart of Sales by Order Date',
      manifests,
      summarizeSchema(SINGLE_DATE),
    );

    expect(JSON.stringify(result)).toBe(JSON.stringify(expectedExplicitDateClassification));
  });
});

function bindableSlots(m: TemplateManifest): SlotSpec[] {
  return m.slots.filter((s) => s.bindable);
}

function optionalSlotIds(m: TemplateManifest): string[] {
  return bindableSlots(m)
    .filter((s) => !s.required)
    .map((s) => s.slot_id)
    .sort();
}

function classify(ask: string, schema: SchemaId): ReturnType<typeof classifyNoLlm> {
  return classifyNoLlm(ask, manifests, summaries[schema]);
}

function slotIds(result: NonNullable<ReturnType<typeof classifyNoLlm>>): string[] {
  return result.bindings.map((b) => b.slot_id);
}

// Every (manifest, intent) pair. Built once so the derived-invariant suite and the
// monotonicity suite see the same 396 results.
const MATRIX = CORPUS.flatMap((row) =>
  INTENTS.map(([intent, suffix]) => ({ row, intent, ask: row.ask + suffix })),
);

describe('binder/manifest-encoding-corpus — business-synonym field resolution', () => {
  it('"revenue by region" uniquely resolves to the full-name Sales match', () => {
    const summary = summarizeSchema(businessSynonymSchema(['Sales']));

    const result = classifyNoLlm('revenue by region', manifests, summary);

    expect(result).not.toBeNull();
    expect(result!.bindings).toEqual([
      { slot_id: 'category', field: 'Region' },
      { slot_id: 'measure', field: 'Sales' },
    ]);
  });

  it('a lone partial-caption revenue candidate proposes instead of auto-binding', async () => {
    const result = await bindTemplate({
      ask: 'revenue by region',
      workbookXml: businessSynonymSchema(['Sales Tax']),
      manifests,
    });

    expect(result.status).toBe('propose');
    if (result.status !== 'propose') throw new Error(`expected propose, got ${result.status}`);
    expect(result.llm_input.fields.map((field) => field.name)).toContain('Sales Tax');
  });

  it('a compound literal field suppresses synonym ambiguity for a noun inside its span', () => {
    const summary = summarizeSchema(businessSynonymSchema(['Net Revenue', 'Sales']));

    const result = classifyNoLlm('show Net Revenue by Region', manifests, summary);

    expect(result).not.toBeNull();
    expect(result!.bindings).toEqual([
      { slot_id: 'category', field: 'Region' },
      { slot_id: 'measure', field: 'Net Revenue' },
    ]);
  });

  it('literal Revenue wins over the Sales synonym candidate', () => {
    const summary = summarizeSchema(businessSynonymSchema(['Sales', 'Revenue']));

    const result = classifyNoLlm('Show me revenue by region', manifests, summary);

    expect(result).not.toBeNull();
    expect(result!.bindings).toEqual([
      { slot_id: 'category', field: 'Region' },
      { slot_id: 'measure', field: 'Revenue' },
    ]);
  });

  it('ambiguous revenue candidates propose both Sales and Amount without binding', async () => {
    const distractors = Array.from({ length: 25 }, (_, index) => `Metric ${index + 1}`);
    const workbookXml = businessSynonymSchema(['Sales', 'Amount', ...distractors]);

    const result = await bindTemplate({
      ask: 'Show me revenue by region',
      workbookXml,
      manifests,
    });

    expect(result.status).toBe('propose');
    if (result.status !== 'propose') throw new Error(`expected propose, got ${result.status}`);
    expect(result.llm_input.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(['Sales', 'Amount']),
    );
  });

  it('"customers" uniquely resolves to Customer Name', () => {
    const summary = summarizeSchema(businessSynonymSchema(['Sales'], 'Customer Name'));

    const result = classifyNoLlm('top 10 customers by sales', manifests, summary);

    expect(result).not.toBeNull();
    expect(result!.template).toBe('ranking-ordered-bar');
    expect(result!.bindings).toEqual([
      { slot_id: 'region', field: 'Customer Name' },
      { slot_id: 'sales', field: 'Sales' },
    ]);
    expect(result!.top_n).toBe(10);
  });

  it.each([
    ['products', 'Product Name'],
    ['orders', 'Order ID'],
    ['reps', 'Sales Rep'],
    ['salespeople', 'Sales Person'],
    ['deals', 'Opportunity Name'],
  ])('"%s" uniquely resolves to %s', (noun, dimension) => {
    const summary = summarizeSchema(businessSynonymSchema(['Sales'], dimension));

    const result = classifyNoLlm(`Show me Sales by ${noun}`, manifests, summary);

    expect(result).not.toBeNull();
    expect(result!.template).toBe('magnitude-simple-bar');
    expect(result!.bindings).toEqual([
      { slot_id: 'category', field: dimension },
      { slot_id: 'measure', field: 'Sales' },
    ]);
  });

  it('falls through when a business noun has no caption-pattern match', () => {
    const summary = summarizeSchema(businessSynonymSchema(['Profit']));

    expect(classifyNoLlm('Show me revenue by region', manifests, summary)).toBeNull();
  });
});

describe('binder/manifest-encoding-corpus — deterministic replay coverage', () => {
  it.each(['Show me revenue by customer.', 'Show me revenue by customers.'])(
    'head noun binds the sole matching dimension in "%s"',
    (ask) => {
      const summary = summarizeSchema(classifierSchema(['Sales'], ['Customer Name']));

      expect(classifyNoLlm(ask, manifests, summary)).toMatchObject({
        template: 'magnitude-simple-bar',
        bindings: [
          { slot_id: 'category', field: 'Customer Name' },
          { slot_id: 'measure', field: 'Sales' },
        ],
      });
    },
  );

  it('explicit top-N reaches the ranking template before modifiers attach', () => {
    const summary = summarizeSchema(classifierSchema(['Sales'], ['Customer Name']));

    expect(classifyNoLlm('Show me top 10 customers by revenue.', manifests, summary)).toMatchObject({
      template: 'ranking-ordered-bar',
      bindings: [
        { slot_id: 'region', field: 'Customer Name' },
        { slot_id: 'sales', field: 'Sales' },
      ],
      top_n: 10,
    });
  });

  it('a lone revenue measure binds the KPI template', () => {
    const summary = summarizeSchema(classifierSchema(['Sales'], []));

    expect(classifyNoLlm('Show me revenue.', manifests, summary)).toMatchObject({
      template: 'kpi-text',
      bindings: [{ slot_id: 'value', field: 'Sales' }],
    });
  });

  it('a lone calculated measure caption binds the KPI template', () => {
    const summary = summarizeSchema(classifierSchema([], [], ['Gross Margin %']));

    expect(classifyNoLlm('Show me gross margin %.', manifests, summary)).toMatchObject({
      template: 'kpi-text',
      bindings: [{ slot_id: 'value', field: 'Gross Margin %' }],
    });
  });

  it('declines an ambiguous dimension head noun', () => {
    const summary = summarizeSchema(
      classifierSchema(['Revenue'], ['Customer Name', 'Customer Segment']),
    );

    expect(classifyNoLlm('Show me revenue by customer.', manifests, summary)).toBeNull();
  });

  it('declines top products when more than one measure could supply the ranking', () => {
    const summary = summarizeSchema(classifierSchema(['Sales', 'Profit'], ['Product Name']));

    expect(classifyNoLlm('Show me top products.', manifests, summary)).toBeNull();
  });

  it('declines residual words after a resolvable measure', () => {
    const summary = summarizeSchema(classifierSchema(['Sales'], []));

    expect(classifyNoLlm('Show me revenue growth.', manifests, summary)).toBeNull();
  });
});

describe('binder/manifest-encoding-corpus — census tripwires', () => {
  it('covers every manifest on disk exactly once', () => {
    const onDisk = [...manifests.keys()].sort();
    const covered = CORPUS.map((r) => r.template).sort();
    // A new manifest must arrive with a corpus row (an ask + a stated verdict) rather than
    // slipping in uncovered — that is how 2.46.0's missing encodings stayed invisible.
    expect(covered).toEqual(onDisk);
    expect(onDisk.length).toBe(44);
  });

  it('pins the optional bindable slot inventory of every manifest', () => {
    // THE DROP DETECTOR. Deleting `color` from a symbol-map manifest — exactly the shape of
    // the 2.46.0 defect — fails here first, before any behavioural test has to notice.
    const inventory: Record<string, string[]> = {};
    for (const [name, m] of manifests) {
      const optional = optionalSlotIds(m);
      if (optional.length > 0) inventory[name] = optional;
    }
    expect(inventory).toEqual({
      'box-plot-chart': ['facet'],
      'part-to-whole-waterfall': ['anchor_category'],
      'ranking-ordered-bar': ['facet_row'],
      'spatial-choropleth-map': ['state'],
      'spatial-symbol-map': ['city', 'color', 'state', 'tooltip'],
      'spatial-symbol-map-latlon': ['color', 'detail2', 'size', 'tooltip'],
      'trend-line-chart': ['color_series', 'facet_col'],
    });
    expect(Object.keys(inventory)).toHaveLength(7);
    expect(Object.values(inventory).flat()).toHaveLength(14);
  });

  it('gives every optional bindable slot in the corpus a row in the optional-slot table', () => {
    // Self-extending: a manifest that gains an optional slot fails here until someone writes
    // the ask that fills it and the ask that does not.
    const declared = OPTIONAL_SLOTS.map((r) => `${r.template}.${r.slot}`).sort();
    const actual = [...manifests.values()]
      .flatMap((m) => optionalSlotIds(m).map((slot) => `${m.template}.${slot}`))
      .sort();
    expect(declared).toEqual(actual);
    expect(declared).toHaveLength(14);
  });

  it('pins how much of the manifest-intent matrix reaches a deterministic bind', () => {
    const outcomes = MATRIX.map((c) => classify(c.ask, c.row.schema));
    const bound = outcomes.filter((result) => result !== null).length;
    const failedClosed = outcomes.length - bound;

    expect({ bound, failedClosed, total: outcomes.length }).toEqual({
      bound: 230,
      failedClosed: 166,
      total: 396,
    });
  });

  it('pins how much of the cue matrix has comparable same-template bindings', () => {
    let comparable = 0;
    let failedClosed = 0;
    let rerouted = 0;
    const cued = MATRIX.filter((c) => c.intent !== 'plain');

    for (const c of cued) {
      const plain = classify(c.row.ask, c.row.schema);
      const withCue = classify(c.ask, c.row.schema);
      if (plain === null || withCue === null) failedClosed += 1;
      else if (plain.template !== withCue.template) rerouted += 1;
      else comparable += 1;
    }

    expect({ comparable, failedClosed, rerouted, total: cued.length }).toEqual({
      comparable: 188,
      failedClosed: 158,
      rerouted: 6,
      total: 352,
    });
  });

  it('ww-ou-arrow declares the compound-string-parse hazard that blocks deterministic binding', () => {
    // The one fails-closed verdict above whose mechanism we assert directly rather than
    // characterise, because the manifest declares it.
    expect(hasDeterministicPathBlockingHazard(manifests.get('ww-ou-arrow')!)).toBe(true);
  });
});

describe('binder/manifest-encoding-corpus — derived invariants over the matrix', () => {
  it(`drives ${CORPUS.length} manifests x ${INTENTS.length} intents`, () => {
    expect(MATRIX.length).toBe(396);
  });

  for (const c of MATRIX) {
    it(`${c.row.template} / ${c.intent} obeys the manifest contract`, ({ skip }) => {
      const result = classify(c.ask, c.row.schema);
      if (result === null) {
        skip('classification failed closed; there is no manifest binding to check');
        return;
      }

      const selected = manifests.get(result.template);
      expect(selected, `selected an unknown template '${result.template}'`).toBeDefined();

      // The deterministic path may only one-shot a render-verified template. Every other
      // guarantee in this file rests on this one.
      expect(selected!.fast_path_eligible, `${result.template} is not fast_path_eligible`).toBe(
        true,
      );

      const declared = new Map(bindableSlots(selected!).map((s) => [s.slot_id, s]));
      const bound = slotIds(result);

      // Never bind a slot the template owns outright (calc / generated / pseudo / parameter),
      // and never bind a slot_id the manifest does not declare at all.
      for (const id of bound) {
        expect(
          declared.has(id),
          `${result.template} does not declare a bindable slot '${id}'`,
        ).toBe(true);
      }
      expect(new Set(bound).size, `duplicate slot_id in ${bound.join(',')}`).toBe(bound.length);

      // A partial bind is worse than no bind: the template would render with an empty shelf.
      for (const [id, spec] of declared) {
        if (spec.required)
          expect(bound, `${result.template} left required slot '${id}' unbound`).toContain(id);
      }

      // No fabricated fields. A bind naming a column the schema does not carry is the defect
      // class that let an agent report success on a field it had invented.
      const known = new Set(summaries[c.row.schema].fields.map((f) => f.name));
      for (const b of result.bindings) {
        expect(known.has(b.field), `${result.template} bound unknown field '${b.field}'`).toBe(
          true,
        );
      }
    });
  }
});

describe('binder/manifest-encoding-corpus — comparable same-template cue outcomes', () => {
  // THE 2.46.0 SHAPE, stated as an invariant. When a cue leaves the selected template
  // unchanged, its slot set must be a superset of the plain ask's: adding "in warmer
  // colours" may add an encoding, never drop one. A cue that re-routes to a different
  // template is out of scope here and is covered by the derived invariants above.
  const cued = MATRIX.filter((c) => c.intent !== 'plain');

  for (const c of cued) {
    it(`${c.row.template} / ${c.intent} keeps every slot the plain ask bound`, ({ skip }) => {
      const plain = classify(c.row.ask, c.row.schema);
      const withCue = classify(c.ask, c.row.schema);
      if (plain === null || withCue === null) {
        skip('the plain or cued ask failed closed; there are no two binding sets to compare');
        return;
      }
      if (plain.template !== withCue.template) {
        skip('the cue selected a different template; this invariant only compares one template');
        return;
      }

      const after = new Set(slotIds(withCue));
      for (const id of slotIds(plain)) {
        expect(
          after.has(id),
          `the '${c.intent}' cue dropped slot '${id}' from ${plain.template}`,
        ).toBe(true);
      }
    });
  }
});

describe('binder/manifest-encoding-corpus — declared verdicts for the plain ask', () => {
  it.each(CORPUS.map((r) => [r.template, r] as const))('%s', (_name, row) => {
    const result = classify(row.ask, row.schema);

    if (row.plain.kind === 'fails-closed') {
      expect(result, `expected no deterministic bind: ${row.plain.why}`).toBeNull();
      return;
    }

    expect(result, `expected a bind: ${row.plain.why}`).not.toBeNull();
    const expectedTemplate =
      row.plain.kind === 'routes-elsewhere' ? row.plain.template : row.template;
    expect(result!.template, row.plain.why).toBe(expectedTemplate);
    expect(slotIds(result!).sort(), row.plain.why).toEqual([...row.plain.slots].sort());
  });

  it('never selects a manifest that is not fast_path_eligible', () => {
    // The 20 ineligible manifests are unreachable by construction. Stated once, loudly,
    // because it is the reason two thirds of the corpus rows read 'fails-closed'.
    const ineligible = [...manifests.values()]
      .filter((m) => !m.fast_path_eligible)
      .map((m) => m.template);
    expect(ineligible.length).toBe(20);
    for (const c of MATRIX) {
      const result = classify(c.ask, c.row.schema);
      if (result)
        expect(ineligible, `${c.row.template} / ${c.intent}`).not.toContain(result.template);
    }
  });
});

describe('binder/manifest-encoding-corpus — the optional-slot surface', () => {
  const reachable = OPTIONAL_SLOTS.filter(
    (row): row is OptionalSlotRow & { fills: FillCase } => !('unreachable' in row.fills),
  );
  const unreachable = OPTIONAL_SLOTS.filter(
    (row): row is OptionalSlotRow & { fills: { unreachable: true; why: string } } =>
      'unreachable' in row.fills,
  );

  it.each(reachable.map((r) => [`${r.template}.${r.slot}`, r] as const))(
    '%s fills in its declared positive cases',
    (_label, row) => {
      for (const c of [row.fills, ...(row.alsoFills ?? [])]) {
        const result = classify(c.ask, c.schema);
        expect(result, c.why).not.toBeNull();
        expect(result!.template, c.why).toBe(row.template);
        expect(
          result!.bindings.find((b) => b.slot_id === row.slot),
          c.why,
        ).toEqual(expect.objectContaining({ slot_id: row.slot, field: c.field }));
      }
    },
  );

  it.skip.each(unreachable.map((r) => [`${r.template}.${r.slot}`, r.fills.why] as const))(
    '%s has no classify-time fill case: %s',
    () => {},
  );

  it.each(OPTIONAL_SLOTS.map((r) => [`${r.template}.${r.slot}`, r] as const))(
    '%s stays unbound in its declared negative case',
    (_label, row) => {
      const result = classify(row.staysUnbound.ask, row.staysUnbound.schema);
      expect(result, row.staysUnbound.why).not.toBeNull();
      expect(result!.template, row.staysUnbound.why).toBe(row.template);
      expect(slotIds(result!), row.staysUnbound.why).not.toContain(row.slot);
    },
  );
});

describe('binder/manifest-encoding-corpus — a "warmer" cue drops the field it names (characterisation)', () => {
  // CHARACTERISATION-ONLY, AND WE BELIEVE IT IS WRONG.
  //
  // naturallyDirectedColorField only reads a "colour(ed)/shade(d) BY <field>" clause. The
  // "warmer/hotter/heat" wording arms the colour encoding but is never scanned for a field,
  // so an ask that says which measure should drive the warmth has that measure discarded and
  // the already-bound size measure put on colour instead.
  //
  // "…with warmer colours where Quantity is higher" therefore colours by Sales. That is
  // worse than leaving colour unbound: the map looks like it honoured the request while
  // encoding a different measure, and nothing downstream can tell the difference.
  //
  // Pinned so a fix is deliberate. The correct outcome is colour=Quantity, or colour
  // unbound with the request reported as unfilled — not silently colour=Sales.
  it('colours by the bound size measure, not the measure the ask named', () => {
    const result = classify(
      'symbol map of Sales by Country/Region, State/Province, and City, with warmer colours where Quantity is higher',
      'superstore',
    );
    expect(result).not.toBeNull();
    expect(result!.template).toBe('spatial-symbol-map');
    expect(result!.bindings).toContainEqual(
      expect.objectContaining({ slot_id: 'color', field: 'Sales' }),
    );
    expect(result!.bindings.map((b) => b.field)).not.toContain('Quantity');
  });

  it('gets it right when the same ask says "coloured by"', () => {
    // The contrast that shows the gap is in the cue scanner, not in the slot or the shelf.
    const result = classify(
      'symbol map of Sales by Country/Region, State/Province, and City, coloured by Quantity',
      'superstore',
    );
    expect(result!.bindings).toContainEqual(
      expect.objectContaining({ slot_id: 'color', field: 'Quantity' }),
    );
  });
});

describe('binder/manifest-encoding-corpus — geo fallback can mis-bind an optional state slot (characterisation)', () => {
  // CHARACTERISATION-ONLY, AND WE BELIEVE IT IS WRONG. Found while writing the
  // staysUnbound rows above.
  //
  // Optional ask-named geo slots DO reach resolveGeoSlots. roleGreedyBind first calls
  // pickGeoField for each optional geo slot (classify.ts:1588-1596), then isActive admits
  // each successful optional pick into geoSlots (classify.ts:1658-1661). Required and
  // admitted optional geo slots therefore use the same resolver.
  //
  // The mis-bind happens inside pickGeoField's fallback. For a `state` slot,
  // [Country/Region] is removed because its [Country].[Name] semantic role names a different
  // geo concept, while untagged [Region] remains and becomes the unique name-affinity winner.
  // This contradicts classify.ts:1436-1438's claim that Region ties Country/Region and fails
  // closed. A required `state` slot over the same pool would make the same bad pick.
  //
  // Pinned rather than asserted-correct so the day this is fixed is a deliberate, visible
  // change. A fix should make `state` unbound here, or bind [State/Province]; either way
  // this test must be rewritten, not re-recorded.
  const CASES = [
    ['spatial-symbol-map', 'symbol map of Sales by Country/Region'],
    ['spatial-choropleth-map', 'filled map of Profit by Country/Region'],
  ] as const;

  it.each(CASES)(
    '%s puts the non-geo [Region] field in the optional state slot',
    (template, ask) => {
      const superstore = summaries.superstore;
      expect(superstore.fields.find((f) => f.name === 'Region')?.semanticRole).toBeUndefined();
      expect(superstore.fields.find((f) => f.name === 'State/Province')?.semanticRole).toBe(
        '[State].[Name]',
      );

      const result = classify(ask, 'superstore');
      expect(result).not.toBeNull();
      expect(result!.template).toBe(template);
      expect(result!.bindings).toContainEqual(
        expect.objectContaining({ slot_id: 'state', field: 'Region' }),
      );
    },
  );
});

describe('binder/manifest-encoding-corpus — cue degradation (fail-closed pins)', () => {
  it.each(CUE_DEGRADATION.map((r) => [r.cued, r] as const))('%s', (_label, row) => {
    const base = classify(row.base, row.schema);
    expect(base, `the base ask must bind for this pin to mean anything: ${row.why}`).not.toBeNull();
    expect(base!.template).toBe(row.boundTemplate);
    // Fails closed, so the LLM propose path handles it. What must never happen is a silent
    // bind to some other template that drops the cue.
    expect(classify(row.cued, row.schema), row.why).toBeNull();
  });
});

describe('binder/manifest-encoding-corpus — cue reroute pins', () => {
  it.each(REROUTED_CUES.map((r) => [r.cued, r] as const))('%s', (_label, row) => {
    const base = classify(row.base, row.schema);
    expect(base, `the base ask must bind for this pin to mean anything: ${row.why}`).not.toBeNull();
    expect(base!.template, row.why).toBe(row.fromTemplate);

    const rerouted = classify(row.cued, row.schema);
    expect(rerouted, row.why).not.toBeNull();
    expect(rerouted!.template, row.why).toBe(row.toTemplate);

    const baseFields = base!.bindings.map((binding) => binding.field);
    const reroutedFields = rerouted!.bindings.map((binding) => binding.field);
    for (const field of row.droppedFields) {
      expect(baseFields, `${field} must be present before the reroute: ${row.why}`).toContain(
        field,
      );
      expect(reroutedFields, row.why).not.toContain(field);
    }
  });
});
