import fs from 'fs';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

import { type BinderResult, bindTemplate, classifyNoLlm, summarizeSchema } from './binder.js';
import { loadManifests } from './manifest.js';
import type { TemplateManifest } from './manifest-types.js';

// W60-PORTABILITY-CI — the committed invariant lock for tonight's portability spike
// (report: ~/.claude/state/minion/w60-portability-spike.md). That spike proved the
// deterministic fast path is SCHEMA-DRIVEN, not Superstore-shaped: ZERO wrong-binds
// across 3 synthetic alien schemas (SaaS revenue ops, hospital ops, adversarial
// field-name collisions). The evidence lived only in /tmp; this suite makes the
// headline a permanent CI invariant against COMMITTED fixtures.
//
// THE HEADLINE (§1): for every fast_path_eligible template's natural, per-domain ask,
// the Call-1 no-LLM binder must EITHER bind to the template that ask targets OR fail
// closed (not bound) — it must NEVER bind to a DIFFERENT template. Total wrong-binds
// across all fixtures = 0.
//
// Everything runs OFFLINE via loadManifests + bindTemplate (no proposal / no llmPropose),
// so every result is the pure model-free Call-1 decision: 'bound' (used_llm=false) or
// 'propose'/'escalate' (not bound). Pinned outcomes were DISCOVERED on the first run
// against the committed fixtures (see pinned-current-behavior notes on each row); two
// diverged from the spike's original /tmp run and are called out where they occur:
//   • the eligible set is now 20 (adds the W62 render-stamp evidence wave after the
//     spike), and
//   • gantt-task-rollup-chart now ONE-SHOTS (the spike's gate-4 MIN-over-date demotion
//     was fixed in validate.ts after the spike captured its snapshot).

const FIXTURE_DIR = path.join(process.cwd(), 'src', 'desktop', 'binder', 'fixtures', 'portability');

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}

const SAAS = loadFixture('saas.xml');
const HOSPITAL = loadFixture('hospital.xml');
const ADVERSARIAL = loadFixture('adversarial.xml');

// The full render-verified fast_path_eligible set this suite pins. Kept explicit so a
// NEW eligibility stamp trips the tripwire below and forces this suite to be extended
// (a natural ask targeting the new template) rather than silently under-covering.
const EXPECTED_ELIGIBLE = [
  'box-plot-chart',
  'connected-scatterplot',
  'control-chart-xmr',
  'correlation-bubble-chart',
  'correlation-scatter-plot-chart',
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
  'ranking-dot-strip-plot',
  'ranking-ordered-bar',
  'ranking-ordered-column',
  'slope-chart',
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

function bind(ask: string, xml: string): ReturnType<typeof bindTemplate> {
  return bindTemplate({ ask, workbookXml: xml, manifests });
}

function boundTemplate(r: BinderResult): string | null {
  return r.status === 'bound' ? r.args.template_name : null;
}

function fieldMapping(r: BinderResult): Record<string, string> | null {
  return r.status === 'bound' ? r.args.field_mapping : null;
}

type Pinned = 'bound' | 'not-bound';

interface Ask {
  /** The natural, per-domain phrasing. */
  ask: string;
  /**
   * The eligible template this ask is the natural phrasing FOR — used by the coverage
   * tripwire. Always a real eligible template name (even when the correct outcome is a
   * refusal).
   */
  targets: string;
  /**
   * The ONLY template this ask may legally bind to. `null` => it must NEVER bind to
   * ANYTHING (refuse-by-design: a bind would be wrong — geo on non-geo data, the
   * ww-ou-arrow compound-string hazard, or a time-series with no temporal field).
   * When non-null it equals `targets`.
   */
  mayBind: string | null;
  /** Outcome discovered on first run against the committed fixture. */
  pinned: Pinned;
  /** pinned-current-behavior rationale. */
  note: string;
}

interface Fixture {
  label: string;
  xml: string;
  datasource: string;
  asks: Ask[];
}

// ── Fixture A: SaaS revenue ops ───────────────────────────────────────────────
const SAAS_ASKS: Ask[] = [
  {
    ask: 'bar chart of ARR by Industry',
    targets: 'ranking-ordered-bar',
    mayBind: 'ranking-ordered-bar',
    pinned: 'bound',
    note: 'measure ARR + dim Industry fill the ordered-bar slots',
  },
  {
    ask: 'magnitude chart of ARR by Industry',
    targets: 'magnitude-simple-bar',
    mayBind: 'magnitude-simple-bar',
    pinned: 'bound',
    note: 'magnitude intent + ARR + Industry fill the generic magnitude bar slots',
  },
  {
    ask: 'column chart of ARR by Industry',
    targets: 'ranking-ordered-column',
    mayBind: 'ranking-ordered-column',
    pinned: 'bound',
    note: "distinct 'column' chart noun one-shots the ordered-column sibling",
  },
  {
    ask: 'treemap of ARR by Industry and Account Name',
    targets: 'part-to-whole-treemap-chart',
    mayBind: 'part-to-whole-treemap-chart',
    pinned: 'bound',
    note: 'two categoricals + ARR fill category/sub-category/sales',
  },
  {
    ask: 'stacked bar of ARR by Industry and Region Name',
    targets: 'part-to-whole-stacked-bar-chart',
    mayBind: 'part-to-whole-stacked-bar-chart',
    pinned: 'bound',
    note: 'two categoricals + ARR fill region/category/sales',
  },
  {
    ask: 'waterfall of ARR by Industry',
    targets: 'part-to-whole-waterfall',
    mayBind: 'part-to-whole-waterfall',
    pinned: 'bound',
    note: 'waterfall intent word + ARR + Industry',
  },
  {
    ask: 'pie chart of ARR by Industry',
    targets: 'part-to-whole-pie-chart',
    mayBind: 'part-to-whole-pie-chart',
    pinned: 'bound',
    note: 'pie chart noun + ARR + Industry fill wedge-size and color',
  },
  {
    ask: 'line chart of ARR by Renewal Date',
    targets: 'trend-line-chart',
    mayBind: 'trend-line-chart',
    pinned: 'bound',
    note: 'temporal [Renewal Date] fills the time slot',
  },
  {
    ask: 'total ARR as a KPI',
    targets: 'kpi-text',
    mayBind: 'kpi-text',
    pinned: 'bound',
    note: 'single required quantitative value = ARR',
  },
  {
    ask: 'gantt of Seats by Account Name and Industry over Renewal Date',
    targets: 'gantt-task-rollup-chart',
    mayBind: 'gantt-task-rollup-chart',
    pinned: 'bound',
    note: 'DIVERGES FROM SPIKE: gantt now one-shots (MIN-over-date gate fixed in validate.ts post-spike); Start Date=min:Renewal Date, Duration=sum:Seats',
  },
  {
    ask: 'scatter plot of ARR and Seats by Account Name and Industry',
    targets: 'correlation-scatter-plot-chart',
    mayBind: 'correlation-scatter-plot-chart',
    pinned: 'bound',
    note: 'scatter needs TWO measures + TWO categorical detail slots; two-dim phrasing fills all four',
  },
  {
    ask: 'bullet chart of ARR and Seats by Industry',
    targets: 'quota-attainment-bullet',
    mayBind: 'quota-attainment-bullet',
    pinned: 'bound',
    note: 'actual=ARR + quota=Seats + entity=Industry',
  },
  {
    ask: 'funnel of ARR by Industry',
    targets: 'funnel-chart',
    mayBind: 'funnel-chart',
    pinned: 'bound',
    note: 'stage=Industry + amount=ARR',
  },
  {
    ask: 'box plot of ARR by Account Name',
    targets: 'box-plot-chart',
    mayBind: 'box-plot-chart',
    pinned: 'bound',
    note: 'measure=ARR + level=Account Name',
  },
  {
    ask: 'over-under arrow chart of ARR by Account Name',
    targets: 'ww-ou-arrow',
    mayBind: null,
    pinned: 'not-bound',
    note: 'ww-ou-arrow compound-string-parse hazard -> unconditional demotion to propose (fix b1490be5)',
  },
  {
    ask: 'strip plot of ARR by Account Name',
    targets: 'distribution-bar-code-chart',
    mayBind: null,
    pinned: 'not-bound',
    note: 'bar-code hard-codes TWO geo detail slots (country+state); non-geo schema -> fail closed',
  },
  {
    ask: 'choropleth of ARR by Region Name',
    targets: 'spatial-choropleth-map',
    mayBind: null,
    pinned: 'not-bound',
    note: 'GEO REFUSAL: [Region Name] is a plain string dim, no geo role -> must not bind (regression lock for W60 geo-slot widening)',
  },
  {
    ask: 'filled map of ARR by Region Name',
    targets: 'spatial-choropleth-map',
    mayBind: null,
    pinned: 'not-bound',
    note: 'GEO REFUSAL #2: same, phrased as filled map',
  },
  {
    ask: 'symbol map of ARR by Region Name',
    targets: 'spatial-symbol-map',
    mayBind: null,
    pinned: 'not-bound',
    note: 'GEO REFUSAL #3: symbol map is stamped but SaaS Region Name is not geocodable',
  },
  {
    ask: 'connected scatterplot of ARR vs Seats by Account Name colored by Industry',
    targets: 'connected-scatterplot',
    mayBind: 'connected-scatterplot',
    pinned: 'bound',
    note: "W63 coverage: two measures (X/Profit-Ratio) + a color dim + a detail dim one-shot the connected-scatterplot; the 'connected' qualifier disambiguates it from the plain correlation-scatter-plot-chart (which owns the bare 'scatter' noun after W63 dropped connected-scatterplot's 'scatter' alias)",
  },
  {
    ask: 'slope chart of ARR by Industry over Renewal Date',
    targets: 'slope-chart',
    mayBind: 'slope-chart',
    pinned: 'bound',
    note: "W63 coverage: 'slope' chart noun + measure + dim + temporal [Renewal Date] fills the endpoint-period slope slots",
  },
  {
    ask: 'dot strip plot of ARR by Industry over Renewal Date',
    targets: 'ranking-dot-strip-plot',
    mayBind: null,
    pinned: 'not-bound',
    note: 'W63 coverage: ranking-dot-strip-plot requires a MONTH-derivation temporal on rows (deriv=mn) + measure on cols + a detail dim; the SaaS phrasing does not fill the month-grain rows slot deterministically -> honest propose (fail-open to the LLM path), not a wrong one-shot',
  },
];

// ── Fixture B: Hospital ops ───────────────────────────────────────────────────
const HOSPITAL_ASKS: Ask[] = [
  {
    ask: 'bar chart of Cost by Department',
    targets: 'ranking-ordered-bar',
    mayBind: 'ranking-ordered-bar',
    pinned: 'bound',
    note: 'measure Cost + dim Department',
  },
  {
    ask: 'column chart of Cost by Department',
    targets: 'ranking-ordered-column',
    mayBind: 'ranking-ordered-column',
    pinned: 'bound',
    note: "'column' noun -> ordered-column sibling",
  },
  {
    ask: 'treemap of Cost by Department and Physician',
    targets: 'part-to-whole-treemap-chart',
    mayBind: 'part-to-whole-treemap-chart',
    pinned: 'bound',
    note: 'two categoricals + Cost',
  },
  {
    ask: 'stacked bar of Cost by Department and Readmitted',
    targets: 'part-to-whole-stacked-bar-chart',
    mayBind: 'part-to-whole-stacked-bar-chart',
    pinned: 'bound',
    note: 'two categoricals (incl boolean Readmitted) + Cost',
  },
  {
    ask: 'waterfall of Cost by Department',
    targets: 'part-to-whole-waterfall',
    mayBind: 'part-to-whole-waterfall',
    pinned: 'bound',
    note: 'waterfall intent + Cost + Department',
  },
  {
    ask: 'line chart of Cost by Admission Date',
    targets: 'trend-line-chart',
    mayBind: 'trend-line-chart',
    pinned: 'bound',
    note: 'temporal [Admission Date] fills time slot',
  },
  {
    ask: 'control chart of Cost by Admission Date',
    targets: 'control-chart-xmr',
    mayBind: null,
    pinned: 'not-bound',
    note: 'pinned-current-behavior: W62 stamp made it eligible, but no-LLM classifier still proposes on this phrasing',
  },
  {
    ask: 'total Cost as a KPI',
    targets: 'kpi-text',
    mayBind: 'kpi-text',
    pinned: 'bound',
    note: 'value = Cost',
  },
  {
    ask: 'gantt of Length of Stay by Physician and Department over Admission Date',
    targets: 'gantt-task-rollup-chart',
    mayBind: 'gantt-task-rollup-chart',
    pinned: 'bound',
    note: 'DIVERGES FROM SPIKE: gantt now one-shots; Start Date=min:Admission Date, Duration=sum:Length of Stay',
  },
  {
    ask: 'scatter plot of Cost and Length of Stay by Physician and Department',
    targets: 'correlation-scatter-plot-chart',
    mayBind: 'correlation-scatter-plot-chart',
    pinned: 'bound',
    note: 'two measures + two detail dims fill all four scatter slots',
  },
  {
    ask: 'bullet chart of Cost and Length of Stay by Department',
    targets: 'quota-attainment-bullet',
    mayBind: 'quota-attainment-bullet',
    pinned: 'bound',
    note: 'actual=Cost + quota=Length of Stay + entity=Department',
  },
  {
    ask: 'funnel of Cost by Department',
    targets: 'funnel-chart',
    mayBind: 'funnel-chart',
    pinned: 'bound',
    note: 'stage=Department + amount=Cost',
  },
  {
    ask: 'box plot of Length of Stay by Physician',
    targets: 'box-plot-chart',
    mayBind: 'box-plot-chart',
    pinned: 'bound',
    note: 'measure=Length of Stay + level=Physician',
  },
  {
    ask: 'over-under arrow chart of Cost by Department',
    targets: 'ww-ou-arrow',
    mayBind: null,
    pinned: 'not-bound',
    note: 'compound-string-parse hazard -> propose',
  },
  {
    ask: 'strip plot of Length of Stay by Physician',
    targets: 'distribution-bar-code-chart',
    mayBind: null,
    pinned: 'not-bound',
    note: 'bar-code needs two geo slots -> fail closed',
  },
  {
    ask: 'choropleth of Cost by Department',
    targets: 'spatial-choropleth-map',
    mayBind: null,
    pinned: 'not-bound',
    note: 'GEO REFUSAL: no geo fields',
  },
];

// ── Fixture C: Adversarial field-name collisions ──────────────────────────────
// [Trend],[Waterfall Stage] = DIMENSIONS; [Max Temp],[Line Items],[Count of Errors],
// [Average Score] = MEASURES. The masking must hold: a field NAMED like a chart noun or
// an aggregation word must not drive selection.
const ADVERSARIAL_ASKS: Ask[] = [
  {
    ask: 'bar chart of Max Temp by Trend',
    targets: 'ranking-ordered-bar',
    mayBind: 'ranking-ordered-bar',
    pinned: 'bound',
    note: 'HIJACK TEST: dim [Trend] masked -> must NOT bind trend-line-chart; bar wins',
  },
  {
    ask: 'column chart of Count of Errors by Waterfall Stage',
    targets: 'ranking-ordered-column',
    mayBind: 'ranking-ordered-column',
    pinned: 'bound',
    note: 'dim [Waterfall Stage] masked -> column wins, not waterfall/funnel',
  },
  {
    ask: 'bar chart of Count of Errors by Waterfall Stage',
    targets: 'ranking-ordered-bar',
    mayBind: 'ranking-ordered-bar',
    pinned: 'bound',
    note: 'HEADLINE: a field named [Waterfall Stage] must not false-trigger the waterfall',
  },
  {
    ask: 'waterfall of Max Temp by Trend',
    targets: 'part-to-whole-waterfall',
    mayBind: 'part-to-whole-waterfall',
    pinned: 'bound',
    note: 'CONTROL: the WORD waterfall (intent) correctly binds the waterfall',
  },
  {
    ask: 'treemap of Max Temp by Trend and Waterfall Stage',
    targets: 'part-to-whole-treemap-chart',
    mayBind: 'part-to-whole-treemap-chart',
    pinned: 'bound',
    note: 'two dims + Max Temp',
  },
  {
    ask: 'stacked bar of Average Score by Trend and Waterfall Stage',
    targets: 'part-to-whole-stacked-bar-chart',
    mayBind: 'part-to-whole-stacked-bar-chart',
    pinned: 'bound',
    note: 'field [Average Score] must NOT read as an AVG override (default sum kept)',
  },
  {
    ask: 'box plot of Max Temp by Trend',
    targets: 'box-plot-chart',
    mayBind: 'box-plot-chart',
    pinned: 'bound',
    note: 'measure=Max Temp + level=Trend',
  },
  {
    ask: 'funnel of Max Temp by Waterfall Stage',
    targets: 'funnel-chart',
    mayBind: 'funnel-chart',
    pinned: 'bound',
    note: 'stage=Waterfall Stage + amount=Max Temp',
  },
  {
    ask: 'bullet chart of Max Temp and Line Items by Trend',
    targets: 'quota-attainment-bullet',
    mayBind: 'quota-attainment-bullet',
    pinned: 'bound',
    note: 'actual=Max Temp + quota=Line Items + entity=Trend',
  },
  {
    ask: 'scatter plot of Max Temp and Line Items by Trend and Waterfall Stage',
    targets: 'correlation-scatter-plot-chart',
    mayBind: 'correlation-scatter-plot-chart',
    pinned: 'bound',
    note: 'two measures + two dims fill all four scatter slots',
  },
  {
    ask: 'bubble chart of Max Temp, Line Items, and Average Score by Trend',
    targets: 'correlation-bubble-chart',
    mayBind: null,
    pinned: 'not-bound',
    note: 'pinned-current-behavior: W62 stamp made it eligible, but no-LLM classifier still proposes on this phrasing',
  },
  {
    ask: 'line chart of Max Temp by Trend',
    targets: 'trend-line-chart',
    mayBind: null,
    pinned: 'not-bound',
    note: 'line intent but NO temporal field ([Trend] is a string dim) -> fail closed (safe)',
  },
  {
    ask: 'gantt of Line Items by Trend and Waterfall Stage',
    targets: 'gantt-task-rollup-chart',
    mayBind: null,
    pinned: 'not-bound',
    note: 'no temporal field -> fail closed',
  },
  {
    ask: 'choropleth of Max Temp by Trend',
    targets: 'spatial-choropleth-map',
    mayBind: null,
    pinned: 'not-bound',
    note: 'no geo fields -> fail closed',
  },
];

const FIXTURES: Fixture[] = [
  { label: 'A-SaaS', xml: SAAS, datasource: 'SaaS Revenue', asks: SAAS_ASKS },
  { label: 'B-Hospital', xml: HOSPITAL, datasource: 'Hospital Ops', asks: HOSPITAL_ASKS },
  { label: 'C-Adversarial', xml: ADVERSARIAL, datasource: 'Adversarial', asks: ADVERSARIAL_ASKS },
];

// Flattened rows for programmatic iteration (object form so vitest interpolates $label/$ask).
interface Row extends Ask {
  label: string;
  xml: string;
  datasource: string;
}
const ALL_ROWS: Row[] = FIXTURES.flatMap((f) =>
  f.asks.map((a) => ({ ...a, label: f.label, xml: f.xml, datasource: f.datasource })),
);

/** A bind is WRONG when it binds to a template other than the one the ask may bind to
 *  (or binds at all when `mayBind` is null / refuse-by-design). */
function isWrongBind(row: Ask, r: BinderResult): boolean {
  const bt = boundTemplate(r);
  if (bt === null) return false; // not bound is always safe
  return row.mayBind === null || bt !== row.mayBind;
}

describe('portability/invariant — fixture & eligibility tripwires', () => {
  it('the eligible set is exactly the 20 render-verified templates this suite covers', () => {
    // If a NEW template is stamped fast_path_eligible, this fails — extend the fixtures
    // with a natural ask targeting it (discover-and-pin) rather than under-covering.
    expect(eligibleNames).toEqual(EXPECTED_ELIGIBLE);
  });

  it('every fast_path_eligible template has a natural ask targeting it (coverage)', () => {
    const targeted = [...new Set(ALL_ROWS.map((r) => r.targets))].sort();
    expect(targeted).toEqual(eligibleNames);
  });

  it.each(FIXTURES)(
    '$label summarizes to its own alien datasource + roles',
    ({ xml, datasource }) => {
      const s = summarizeSchema(xml);
      expect(s.datasource).toBe(datasource);
      expect(s.fields.length).toBeGreaterThan(0);
      // sanity: every field resolves within the primary datasource
      for (const f of s.fields) expect(f.datasource).toBe(datasource);
    },
  );

  it('the ask table is internally consistent (mayBind agrees with pinned/targets)', () => {
    for (const r of ALL_ROWS) {
      if (r.pinned === 'bound') {
        expect(r.mayBind, `${r.ask}: a pinned-bound ask must name the template it binds`).toBe(
          r.targets,
        );
      } else {
        expect(r.mayBind, `${r.ask}: a pinned-not-bound ask is refuse-by-design`).toBeNull();
      }
    }
  });
});

describe('portability/invariant — ZERO WRONG-BINDS (the headline)', () => {
  it.each(ALL_ROWS)('$label | "$ask" never binds to a wrong template', async (row) => {
    const r = await bind(row.ask, row.xml);
    expect(
      isWrongBind(row, r),
      `${row.ask} bound to ${boundTemplate(r)} (may bind: ${row.mayBind ?? 'NOTHING'})`,
    ).toBe(false);
  });

  it('TOTAL WRONG-BINDS across all fixtures = 0', async () => {
    const wrong: string[] = [];
    for (const row of ALL_ROWS) {
      const r = await bind(row.ask, row.xml);
      if (isWrongBind(row, r)) {
        wrong.push(`${row.label} | "${row.ask}" -> ${boundTemplate(r)} (may bind: ${row.mayBind})`);
      }
    }
    expect(wrong, 'the dangerous cell must stay empty').toEqual([]);
  });

  // Cross-bind guard (N×N): every BOUND ask binds to its target and to NONE of the other
  // eligible templates. Iterates the whole eligible set so a future keyword/manifest change
  // that lets an ask reach a sibling is caught for every template, not just the expected one.
  it.each(ALL_ROWS.filter((r) => r.pinned === 'bound'))(
    '$label | "$ask" binds ONLY to $targets across the entire eligible set',
    async (row) => {
      const r = await bind(row.ask, row.xml);
      expect(r.status).toBe('bound');
      if (r.status === 'bound') {
        expect(r.args.template_name).toBe(row.targets);
        for (const name of eligibleNames) {
          if (name === row.targets) continue;
          expect(r.args.template_name, `${row.ask} must never bind to ${name}`).not.toBe(name);
        }
      }
    },
  );
});

describe('portability/invariant — pinned per-fixture outcomes (pinned-current-behavior)', () => {
  it.each(ALL_ROWS.filter((r) => r.pinned === 'bound'))(
    '$label | "$ask" -> bound $targets (used_llm=false) [$note]',
    async (row) => {
      const r = await bind(row.ask, row.xml);
      expect(r.status, `${row.ask} pinned bound`).toBe('bound');
      if (r.status === 'bound') {
        expect(r.used_llm).toBe(false);
        expect(r.args.template_name).toBe(row.targets);
        expect(r.args.template_parameters.DATASOURCE).toBe(row.datasource);
      }
    },
  );

  it.each(ALL_ROWS.filter((r) => r.pinned === 'not-bound'))(
    '$label | "$ask" -> NOT bound [$note]',
    async (row) => {
      const r = await bind(row.ask, row.xml);
      expect(r.status, `${row.ask} pinned not-bound`).not.toBe('bound');
    },
  );
});

describe('portability/invariant — adversarial masking holds', () => {
  const advSummary = (): ReturnType<typeof summarizeSchema> => summarizeSchema(ADVERSARIAL);

  it('classifyNoLlm("chart of Max Temp by Trend") is null (dim [Trend] masked)', () => {
    // The only "trend"-ish token is the FIELD [Trend]; maskFieldNames removes it, so no
    // chart-noun/intent survives -> no classification. Masking is load-bearing.
    expect(classifyNoLlm('chart of Max Temp by Trend', manifests, advSummary())).toBeNull();
  });

  it('classifyNoLlm("chart of Count of Errors by Waterfall Stage") is null (dim [Waterfall Stage] masked)', () => {
    expect(
      classifyNoLlm('chart of Count of Errors by Waterfall Stage', manifests, advSummary()),
    ).toBeNull();
  });

  it('a dimension named [Trend] never hijacks trend-line-chart', async () => {
    const r = await bind('bar chart of Max Temp by Trend', ADVERSARIAL);
    expect(boundTemplate(r)).toBe('ranking-ordered-bar');
    expect(boundTemplate(r)).not.toBe('trend-line-chart');
  });

  it('a dimension named [Waterfall Stage] never false-triggers the waterfall', async () => {
    const r = await bind('bar chart of Count of Errors by Waterfall Stage', ADVERSARIAL);
    expect(boundTemplate(r)).toBe('ranking-ordered-bar');
    expect(boundTemplate(r)).not.toBe('part-to-whole-waterfall');
  });

  // Aggregation-word masking: a field NAMED max/average/count must not force an aggregation
  // override, but an explicit INTENT word ("maximum") must. Value slot of kpi-text.
  const AGG_PROBES: ReadonlyArray<readonly [ask: string, expectValue: string, why: string]> = [
    [
      'Max Temp as a KPI',
      '[Adversarial].[sum:Max Temp:qk]',
      'field name "Max Temp" must NOT force MAX (default sum kept)',
    ],
    [
      'maximum Max Temp as a KPI',
      '[Adversarial].[max:Max Temp:qk]',
      'explicit intent word "maximum" DOES override to max',
    ],
    [
      'Average Score as a KPI',
      '[Adversarial].[sum:Average Score:qk]',
      'field name "Average Score" must NOT force AVG',
    ],
    [
      'Count of Errors as a KPI',
      '[Adversarial].[sum:Count of Errors:qk]',
      'field name "Count of Errors" must NOT force COUNT',
    ],
  ];
  it.each(AGG_PROBES)('"%s" -> Value=%s', async (ask, expectValue) => {
    const r = await bind(ask, ADVERSARIAL);
    expect(r.status).toBe('bound');
    expect(fieldMapping(r)?.['Value']).toBe(expectValue);
  });
});

describe('portability/invariant — geo refusal (regression lock for W60 geo-slot widening)', () => {
  // [Region Name] is a PLAIN string dimension with no geo semantic-role. The W60 geo-slot
  // completion widens a missing geo slot only to GEO-AFFINE candidates; SaaS has none, so a
  // choropleth/filled-map ask must stay not-bound. If a future widening change starts binding
  // geo templates onto non-geo schemas, these fail.
  it('[Region Name] is a plain string dimension (no geo role)', () => {
    const f = summarizeSchema(SAAS).fields.find((x) => x.name === 'Region Name');
    expect(f, 'SaaS fixture must carry [Region Name]').toBeDefined();
    expect(f?.role).toBe('dimension');
    expect(f?.datatype).toBe('string');
  });

  it('SaaS has no measure that could satisfy a geo slot (all measures are quantitative)', () => {
    const measures = summarizeSchema(SAAS).fields.filter((x) => x.role === 'measure');
    expect(measures.length).toBeGreaterThan(0);
    for (const m of measures) expect(m.type).toBe('quantitative');
  });

  const GEO_REFUSALS: ReadonlyArray<string> = [
    'choropleth of ARR by Region Name',
    'filled map of ARR by Region Name',
  ];
  it.each(GEO_REFUSALS)('"%s" stays NOT bound on SaaS', async (ask) => {
    const r = await bind(ask, SAAS);
    expect(r.status, `${ask} must refuse (no geo fields)`).not.toBe('bound');
    expect(boundTemplate(r)).not.toBe('spatial-choropleth-map');
  });
});

describe('portability/invariant — field-mapping quality spot-checks', () => {
  it('trend-line (SaaS): the date lands on the temporal slot, the measure on the quantitative slot', async () => {
    const r = await bind('line chart of ARR by Renewal Date', SAAS);
    const map = fieldMapping(r);
    expect(map).toEqual({
      'Order Date': '[SaaS Revenue].[tmn:Renewal Date:qk]',
      Sales: '[SaaS Revenue].[sum:ARR:qk]',
    });
    // temporal: the date field is bound with a date-truncation derivation (tmn = month)
    expect(map?.['Order Date']).toContain('[tmn:Renewal Date:');
    // quantitative: the measure is bound with a numeric aggregation (sum) on a :qk instance
    expect(map?.['Sales']).toBe('[SaaS Revenue].[sum:ARR:qk]');
  });

  it('ranking-ordered-bar (SaaS): measure -> quantitative slot, dimension -> categorical slot', async () => {
    const r = await bind('bar chart of ARR by Industry', SAAS);
    expect(fieldMapping(r)).toEqual({
      Region: '[SaaS Revenue].[none:Industry:nk]', // categorical (none/:nk)
      Sales: '[SaaS Revenue].[sum:ARR:qk]', // quantitative (sum/:qk)
    });
  });

  it('gantt (Hospital): the date lands on the Start Date slot, the measure on Duration', async () => {
    const r = await bind(
      'gantt of Length of Stay by Physician and Department over Admission Date',
      HOSPITAL,
    );
    const map = fieldMapping(r);
    expect(map).toEqual({
      Task: '[Hospital Ops].[none:Physician:nk]',
      'Start Date': '[Hospital Ops].[min:Admission Date:ok]',
      Duration: '[Hospital Ops].[sum:Length of Stay:qk]',
      Phase: '[Hospital Ops].[none:Department:nk]',
    });
    // the temporal field backs the Start Date slot; the measure backs Duration
    expect(map?.['Start Date']).toContain('Admission Date');
    expect(map?.['Duration']).toBe('[Hospital Ops].[sum:Length of Stay:qk]');
  });

  it('scatter (Adversarial): two measures -> two quantitative slots, two dims -> two detail slots', async () => {
    const r = await bind(
      'scatter plot of Max Temp and Line Items by Trend and Waterfall Stage',
      ADVERSARIAL,
    );
    expect(fieldMapping(r)).toEqual({
      Sales: '[Adversarial].[sum:Max Temp:qk]', // measure -> quantitative
      Profit: '[Adversarial].[sum:Line Items:qk]', // measure -> quantitative
      'Customer Name': '[Adversarial].[none:Trend:nk]', // dim -> categorical detail
      Region: '[Adversarial].[none:Waterfall Stage:nk]', // dim -> categorical detail
    });
  });
});
