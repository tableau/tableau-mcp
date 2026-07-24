// scripts/paraphrase-sweep.mts
//
// W-635 PARAPHRASE SWEEP — a REPORTING tool, not a CI gate. Runs a hardcoded table of
// natural-language chart asks through classifyNoLlm (no LLM calls, in-process) against the
// 85a6e82f fixture schema (Country Code, Goals For, Goals Against, Latitude, Longitude) and
// prints the outcome for each, plus an aggregate confident-bind rate and any WRONG confident
// bind (a template selected but the wrong one, or a required field silently dropped) so a
// human can eyeball real-world phrasing coverage after a classify.ts change. Never asserts,
// never exits non-zero — read the printed table.
//
// Run: node_modules/.bin/tsx scripts/paraphrase-sweep.mts
import { classifyNoLlm, summarizeSchema } from '../src/desktop/binder/binder.js';
import { loadManifests } from '../src/desktop/binder/manifest.js';

const FIXTURE_WORKBOOK_XML = `<workbook><datasources><datasource name='federated.wc' caption='teams+'>
  <connection><relation name='players' /></connection>
  <column name='[country_code]' caption='Country Code' role='dimension' type='nominal' datatype='string' semantic-role='[Country].[ISO3166_2]' />
  <column name='[goals_for]' caption='Goals For' role='measure' type='quantitative' datatype='integer' />
  <column name='[goals_against]' caption='Goals Against' role='measure' type='quantitative' datatype='integer' />
  <column name='[latitude]' caption='Latitude' role='measure' type='quantitative' datatype='real' semantic-role='[Geographical].[Latitude]' aggregation='Avg' />
  <column name='[longitude]' caption='Longitude' role='measure' type='quantitative' datatype='real' semantic-role='[Geographical].[Longitude]' aggregation='Avg' />
</datasource></datasources><worksheets><worksheet name='se-eval-scratch' /></worksheets></workbook>`;

type Row = { group: string; ask: string; expectBind: boolean };

// 10 CHART-EXPLICIT: names the map/symbol-map noun directly.
const CHART_EXPLICIT: Row[] = [
  { group: 'chart-explicit', ask: 'Symbol map of Goals For by Country Code.', expectBind: true },
  { group: 'chart-explicit', ask: 'Build a symbol map of Goals For by country.', expectBind: true },
  { group: 'chart-explicit', ask: 'Bubble map of Goals For by Country Code.', expectBind: true },
  { group: 'chart-explicit', ask: 'Point map showing Goals For by country.', expectBind: true },
  { group: 'chart-explicit', ask: 'Dot map of Goals For by Country Code.', expectBind: true },
  {
    group: 'chart-explicit',
    ask: 'Proportional symbol map of Goals For by country.',
    expectBind: true,
  },
  {
    group: 'chart-explicit',
    ask: 'Graduated symbol map of Goals For by Country Code.',
    expectBind: true,
  },
  {
    group: 'chart-explicit',
    ask: 'Make a map of Goals For by Country Code with dots.',
    expectBind: true,
  },
  {
    group: 'chart-explicit',
    ask: 'Choropleth map of Goals For by Country Code.',
    expectBind: true,
  },
  { group: 'chart-explicit', ask: 'Filled map of Goals For by Country Code.', expectBind: true },
];

// 10 MARK/ENCODING-EXPLICIT, unseen wording: leans on the mark-cue vocabulary (incl. the
// new circle/marker cues) rather than a chart-type noun.
const MARK_EXPLICIT: Row[] = [
  {
    group: 'mark-explicit',
    ask: 'Map the countries by Goals For — bigger, warmer dots.',
    expectBind: true,
  },
  {
    group: 'mark-explicit',
    ask: 'Map the countries by Goals For with bigger, warmer bubbles.',
    expectBind: true,
  },
  {
    group: 'mark-explicit',
    ask: 'Map the countries by Goals For with bigger, warmer circles.',
    expectBind: true,
  },
  {
    group: 'mark-explicit',
    ask: 'Map the countries by Goals For using larger, warmer markers.',
    expectBind: true,
  },
  {
    group: 'mark-explicit',
    ask: 'Map the countries by Goals For with pins sized by the total.',
    expectBind: true,
  },
  {
    group: 'mark-explicit',
    ask: 'Plot each country on a map, dot size = Goals For, color = Goals For.',
    expectBind: true,
  },
  {
    group: 'mark-explicit',
    ask: 'Map the countries by Goals For with bigger warmer dots total.',
    expectBind: true,
  },
  {
    group: 'mark-explicit',
    ask: 'Map the countries by Goals For with bigger warmer dots trend.',
    expectBind: true,
  },
  {
    group: 'mark-explicit',
    ask: 'Map the countries by Goals For with bigger warmer dots rate.',
    expectBind: true,
  },
  {
    group: 'mark-explicit',
    ask: 'Map the countries by Goals For with bigger, warmer points.',
    expectBind: true,
  },
];

// 10 GOAL-LED NATURAL: a plain-language business ask with no chart noun or mark cue.
const GOAL_LED_NATURAL: Row[] = [
  { group: 'goal-led-natural', ask: 'Show me Goals For by country.', expectBind: false },
  { group: 'goal-led-natural', ask: 'How do Goals For compare by country?', expectBind: false },
  { group: 'goal-led-natural', ask: 'Break down Goals For by country.', expectBind: false },
  { group: 'goal-led-natural', ask: 'Where are the most Goals For scored?', expectBind: false },
  {
    group: 'goal-led-natural',
    ask: 'I want to see Goals For across countries.',
    expectBind: false,
  },
  {
    group: 'goal-led-natural',
    ask: 'Compare Goals For and Goals Against by country.',
    expectBind: false,
  },
  {
    group: 'goal-led-natural',
    ask: 'Which countries had the highest Goals For?',
    expectBind: false,
  },
  { group: 'goal-led-natural', ask: 'Rank countries by Goals For.', expectBind: false },
  { group: 'goal-led-natural', ask: 'Give me Goals For per country.', expectBind: false },
  { group: 'goal-led-natural', ask: 'Show Goals For for each country.', expectBind: false },
];

// 10 GEOGRAPHICALLY-CLEAR-BUT-CUE-FREE: unmistakably a location/map ask, but no mark
// word and no chart noun — the classifier's fail-closed floor.
const GEO_CLEAR_CUE_FREE: Row[] = [
  { group: 'geo-clear-cue-free', ask: 'Map of countries.', expectBind: false },
  { group: 'geo-clear-cue-free', ask: 'Show me a map by country.', expectBind: false },
  { group: 'geo-clear-cue-free', ask: 'Map Goals For by country.', expectBind: false },
  {
    group: 'geo-clear-cue-free',
    ask: 'Where do the countries sit geographically?',
    expectBind: true,
  },
  { group: 'geo-clear-cue-free', ask: 'Show country locations.', expectBind: true },
  { group: 'geo-clear-cue-free', ask: 'Plot the countries.', expectBind: false },
  {
    group: 'geo-clear-cue-free',
    ask: 'geographic map of Goals For by country with bigger warmer dots',
    expectBind: true,
  },
  { group: 'geo-clear-cue-free', ask: 'Map coordinates of countries.', expectBind: true },
  { group: 'geo-clear-cue-free', ask: 'Show the countries on a globe.', expectBind: false },
  { group: 'geo-clear-cue-free', ask: 'Country map, no measure specified.', expectBind: false },
];

// 10 NEGATIVES: non-spatial asks that must never be hijacked into a spatial bind.
const NEGATIVES: Row[] = [
  { group: 'negative', ask: 'Bar chart of Goals For by Country Code.', expectBind: true },
  { group: 'negative', ask: 'KPI of total Goals For.', expectBind: true },
  { group: 'negative', ask: 'Trend of Goals For over time.', expectBind: false },
  { group: 'negative', ask: 'Waterfall of Goals For by Country Code.', expectBind: true },
  { group: 'negative', ask: 'gibberish asdf qwerty zxcv', expectBind: false },
  { group: 'negative', ask: 'Pie chart of Goals For by Country Code.', expectBind: true },
  { group: 'negative', ask: 'Scatter of Goals For vs Goals Against.', expectBind: false },
  { group: 'negative', ask: 'Treemap of Goals For by Country Code.', expectBind: false },
  { group: 'negative', ask: 'Funnel of Goals For by Country Code.', expectBind: true },
  { group: 'negative', ask: 'Box plot of Goals For by Country Code.', expectBind: true },
];

const ALL_ROWS: Row[] = [
  ...CHART_EXPLICIT,
  ...MARK_EXPLICIT,
  ...GOAL_LED_NATURAL,
  ...GEO_CLEAR_CUE_FREE,
  ...NEGATIVES,
];

const MEASURE_NAMES = ['goals for', 'goals against'];

/** True when the ask literally names one of the fixture's measures. */
function askNamesAnyMeasure(ask: string): boolean {
  const lower = ask.toLowerCase();
  return MEASURE_NAMES.some((m) => lower.includes(m));
}

// A confident bind is WRONG in either direction:
//   - DROPPED measure: the lat/lon template binds while the ask names a measure, but no
//     size slot got filled — the coordinate-only template has no required measure slot, so
//     the measure would silently vanish (the original W-635 bug the lat/lon-with-measure
//     fill closes).
//   - INVENTED measure: a size/sales slot gets filled even though the ask named NO measure
//     at all — the mark-cue tie-break (or role-greedy bind) must never guess a measure from
//     schema order alone ("map the pins for each country" regression).
function isWrongBind(
  ask: string,
  cls: { template: string; bindings: Array<{ slot_id: string; field: string }> },
): boolean {
  const namesMeasure = askNamesAnyMeasure(ask);
  const sizeBindings = cls.bindings.filter((b) => b.slot_id === 'sales' || b.slot_id === 'size');
  if (cls.template === 'spatial-symbol-map-latlon' && namesMeasure && sizeBindings.length === 0) {
    return true; // DROPPED
  }
  if (sizeBindings.length > 0 && !namesMeasure) {
    return true; // INVENTED
  }
  return false;
}

function main(): void {
  const manifests = loadManifests();
  const summary = summarizeSchema(FIXTURE_WORKBOOK_XML);

  const results = ALL_ROWS.map((row) => {
    const cls = classifyNoLlm(row.ask, manifests, summary);
    const bound = cls !== null;
    const wrong = cls !== null && isWrongBind(row.ask, cls);
    return { ...row, bound, template: cls?.template ?? null, wrong };
  });

  console.log('W-635 paraphrase sweep — classifyNoLlm, no LLM calls\n');

  let currentGroup = '';
  for (const r of results) {
    if (r.group !== currentGroup) {
      currentGroup = r.group;

      console.log(`\n[${currentGroup}]`);
    }
    const outcomeTag = r.wrong ? 'WRONG' : r.bound ? 'BOUND' : 'null ';
    const expectTag = r.bound === r.expectBind ? 'as-expected' : 'UNEXPECTED';

    console.log(
      `  ${outcomeTag}  ${expectTag.padEnd(11)}  ${(r.template ?? '-').padEnd(28)}  "${r.ask}"`,
    );
  }

  const confidentBinds = results.filter((r) => r.bound).length;
  const wrongBinds = results.filter((r) => r.wrong);
  const unexpected = results.filter((r) => r.bound !== r.expectBind);

  console.log('\n── Aggregate ──────────────────────────────────────────────');

  console.log(
    `confident-bind rate: ${confidentBinds}/${results.length} (${Math.round((confidentBinds / results.length) * 100)}%)`,
  );

  console.log(`WRONG confident binds: ${wrongBinds.length}`);
  for (const r of wrongBinds) {
    console.log(`  WRONG: "${r.ask}" -> ${r.template}`);
  }

  console.log(`unexpected vs. hand-labeled expectation: ${unexpected.length}`);
  for (const r of unexpected) {
    console.log(
      `  UNEXPECTED: "${r.ask}" -> bound=${r.bound} (expected ${r.expectBind}), template=${r.template ?? '-'}`,
    );
  }
}

main();
