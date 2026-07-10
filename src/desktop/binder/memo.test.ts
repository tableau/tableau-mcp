import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  type BinderResult,
  type BindingProposal,
  bindTemplate,
  summarizeSchema,
} from './binder.js';
import { loadManifests } from './manifest.js';
import type { Family, TemplateManifest } from './manifest-types.js';
import {
  createMemoizedBinder,
  DEFAULT_SCHEMA_SIDECAR_PATH,
  hashManifests,
  hashSchemaSummary,
  normalizeAsk,
  SchemaCache,
  sha256Hex,
  stableStringify,
} from './memo.js';

// ── Fixtures ──────────────────────────────────────────────────────────────
const SUPERSTORE_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='Superstore'>
      <column name='[Region]' role='dimension' type='nominal' datatype='string' />
      <column name='[Category]' role='dimension' type='nominal' datatype='string' />
      <column name='[Customer Name]' role='dimension' type='nominal' datatype='string' />
      <column name='[Order Date]' role='dimension' type='ordinal' datatype='date' />
      <column name='[Sales]' role='measure' type='quantitative' datatype='real' />
      <column name='[Profit]' role='measure' type='quantitative' datatype='real' />
    </datasource>
  </datasources>
</workbook>`;

// Same fields, different whitespace/formatting ⇒ identical summary ⇒ identical hash.
const SUPERSTORE_XML_REFORMATTED =
  "<?xml version='1.0' encoding='utf-8'?><workbook><datasources><datasource name='Superstore'><column name='[Region]' role='dimension' type='nominal' datatype='string' /><column name='[Category]' role='dimension' type='nominal' datatype='string' /><column name='[Customer Name]' role='dimension' type='nominal' datatype='string' /><column name='[Order Date]' role='dimension' type='ordinal' datatype='date' /><column name='[Sales]' role='measure' type='quantitative' datatype='real' /><column name='[Profit]' role='measure' type='quantitative' datatype='real' /></datasource></datasources></workbook>";

const KPI_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='Bets'>
      <column name='[Team]' role='dimension' type='nominal' datatype='string' />
      <column name='[O/U Line]' role='measure' type='quantitative' datatype='real' />
    </datasource>
  </datasources>
</workbook>`;

function synth(
  template: string,
  family: Family,
  keyword: string,
  slots: TemplateManifest['slots'],
  calcs: TemplateManifest['calcs'] = [],
): TemplateManifest {
  return {
    template,
    family,
    readiness: 'GREEN',
    fast_path_eligible: true,
    fast_path_blockers: [],
    portability_evidence: { fixture_bind: true, render_verified: 'live-2026-07-04' },
    datasource_placeholder: true,
    placeholders: ['TITLE', 'DATASOURCE'],
    intent_keywords: [keyword],
    description: `${family} synthetic`,
    slots,
    calcs,
    hazards: [],
  };
}

// A calc-slot template: a REQUIRED calc forces its (optional) input slots to bind.
const CALC_MANIFEST = synth(
  'x-calc-force',
  'specialized',
  'calcforce',
  [
    {
      slot_id: 'm1',
      template_field: 'M1',
      derivation: 'sum',
      role: ['cols'],
      kind: 'quantitative',
      bindable: true,
      required: true,
    },
    {
      slot_id: 'm2',
      template_field: 'M2',
      derivation: 'sum',
      role: ['rows'],
      kind: 'quantitative',
      bindable: true,
      required: false,
    },
  ],
  [
    {
      slot_id: 'ratio',
      template_field: 'Calculation_1',
      derivation: 'usr',
      role: ['color'],
      kind: 'calc',
      bindable: false,
      required: true,
      formula: 'SUM([M1])/SUM([M2])',
      formula_refs: ['M1', 'M2'],
      depends_on_slots: ['m1', 'm2'],
      result_role: 'measure',
      inputs: [
        {
          ref: 'M1',
          slot_id: 'm1',
          slot_kind: 'quantitative',
          required: true,
          template_internal: false,
        },
        {
          ref: 'M2',
          slot_id: 'm2',
          slot_kind: 'quantitative',
          required: true,
          template_internal: false,
        },
      ],
    },
  ],
);
const CALC_MANIFESTS = new Map([[CALC_MANIFEST.template, CALC_MANIFEST]]);

// A qualified-key template: the slot demands the `template_field@derivation` key form.
const QUALKEY_MANIFEST = synth('x-qualkey', 'magnitude', 'qualkey', [
  {
    slot_id: 'val',
    template_field: 'Sales',
    derivation: 'sum',
    role: ['text'],
    kind: 'quantitative',
    bindable: true,
    required: true,
    qualified_key_required: true,
  },
]);
const QUALKEY_MANIFESTS = new Map([[QUALKEY_MANIFEST.template, QUALKEY_MANIFEST]]);

const real = loadManifests();

// ── stableStringify ───────────────────────────────────────────────────────
describe('memo/stableStringify', () => {
  it('is insensitive to object key order but preserves array order', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    expect(stableStringify({ x: { p: 1, q: 2 } })).toBe(stableStringify({ x: { q: 2, p: 1 } }));
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });
});

describe('memo/sha256Hex', () => {
  it('is deterministic and 64 hex chars', () => {
    expect(sha256Hex('abc')).toBe(sha256Hex('abc'));
    expect(sha256Hex('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex('abc')).not.toBe(sha256Hex('abd'));
  });
});

describe('memo/hashSchemaSummary', () => {
  it('content-hashes the summary: same fields ⇒ same hash regardless of XML formatting', () => {
    const a = hashSchemaSummary(summarizeSchema(SUPERSTORE_XML));
    const b = hashSchemaSummary(summarizeSchema(SUPERSTORE_XML_REFORMATTED));
    expect(a).toBe(b);
  });
  it('differs when the field set differs', () => {
    expect(hashSchemaSummary(summarizeSchema(SUPERSTORE_XML))).not.toBe(
      hashSchemaSummary(summarizeSchema(KPI_XML)),
    );
  });
});

describe('memo/hashManifests', () => {
  it('is order-independent over map insertion order', () => {
    const A = synth('a', 'ranking', 'kwa', QUALKEY_MANIFEST.slots);
    const B = synth('b', 'kpi', 'kwb', QUALKEY_MANIFEST.slots);
    const m1 = new Map([
      ['a', A],
      ['b', B],
    ]);
    const m2 = new Map([
      ['b', B],
      ['a', A],
    ]);
    expect(hashManifests(m1)).toBe(hashManifests(m2));
  });
  it("changes when any manifest's content changes (stale-hash detection)", () => {
    const base = hashManifests(real);
    const mutated = new Map(real);
    const bar = real.get('ranking-ordered-bar')!;
    mutated.set('ranking-ordered-bar', { ...bar, fast_path_eligible: false });
    expect(hashManifests(mutated)).not.toBe(base);
  });
});

describe('memo/normalizeAsk', () => {
  it('trims and collapses whitespace but preserves case', () => {
    expect(normalizeAsk('  bar   chart  of Sales ')).toBe('bar chart of Sales');
    expect(normalizeAsk('BAR chart')).toBe('BAR chart');
    expect(normalizeAsk('BAR chart')).not.toBe(normalizeAsk('bar chart'));
  });
});

// ── SchemaCache ───────────────────────────────────────────────────────────
describe('memo/SchemaCache', () => {
  it('misses then hits, returning a summary equal to summarizeSchema', () => {
    const c = new SchemaCache();
    const first = c.getOrCompute(SUPERSTORE_XML);
    expect(first.hit).toBe(false);
    expect(first.summary).toEqual(summarizeSchema(SUPERSTORE_XML));
    const second = c.getOrCompute(SUPERSTORE_XML);
    expect(second.hit).toBe(true);
    expect(second.summary).toEqual(first.summary);
    expect(c.stats.hits).toBe(1);
    expect(c.stats.misses).toBe(1);
  });

  it('invalidates only by content: reformatted-but-equivalent XML still misses (raw-bytes key), distinct XML misses', () => {
    const c = new SchemaCache();
    c.getOrCompute(SUPERSTORE_XML);
    // Different raw bytes ⇒ its own key ⇒ a fresh compute (miss), never a stale hit.
    expect(c.getOrCompute(SUPERSTORE_XML_REFORMATTED).hit).toBe(false);
    expect(c.getOrCompute(KPI_XML).hit).toBe(false);
  });

  it('persists to and loads from an optional JSON sidecar', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binder-schema-sidecar-'));
    const sidecar = path.join(dir, 'schema-cache.json');
    try {
      const a = new SchemaCache({ sidecarPath: sidecar });
      a.getOrCompute(SUPERSTORE_XML);
      expect(fs.existsSync(sidecar)).toBe(true);
      // A fresh instance pointed at the same sidecar warm-loads the entry ⇒ hit, no recompute.
      const b = new SchemaCache({ sidecarPath: sidecar });
      const loaded = b.getOrCompute(SUPERSTORE_XML);
      expect(loaded.hit).toBe(true);
      expect(loaded.summary).toEqual(summarizeSchema(SUPERSTORE_XML));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('its default sidecar path lives under the gitignored cache/ directory', () => {
    expect(DEFAULT_SCHEMA_SIDECAR_PATH.split(path.sep)).toContain('cache');
  });
});

// ── createMemoizedBinder — hit/miss semantics ──────────────────────────────
describe('memo/createMemoizedBinder — no-LLM bound', () => {
  it('first bind misses, second bind hits, both equal the unmemoized result', async () => {
    const binder = createMemoizedBinder();
    const args = {
      ask: 'bar chart of Sales by Region',
      workbookXml: SUPERSTORE_XML,
      manifests: real,
    };
    const unmemoized = await bindTemplate(args);

    const first = await binder.bind(args);
    expect(first.cache.hit).toBe(false);
    const { cache: _c1, ...firstBody } = first;
    expect(firstBody).toEqual(unmemoized);

    const second = await binder.bind(args);
    expect(second.cache.hit).toBe(true);
    expect(second.cache.key).toBe(first.cache.key);
    const { cache: _c2, ...secondBody } = second;
    expect(secondBody).toEqual(unmemoized);
  });

  it('normalization: whitespace-only variance shares a cache entry (a hit), case variance does not', async () => {
    const binder = createMemoizedBinder();
    const base = { workbookXml: SUPERSTORE_XML, manifests: real };
    const a = await binder.bind({ ...base, ask: 'bar chart of Sales by Region' });
    expect(a.cache.hit).toBe(false);
    const b = await binder.bind({ ...base, ask: 'bar   chart  of Sales by Region  ' });
    expect(b.cache.hit).toBe(true);
    // Uppercasing changes the title (a real result change) ⇒ must NOT collide.
    const c = await binder.bind({ ...base, ask: 'BAR CHART of Sales by Region' });
    expect(c.cache.hit).toBe(false);
    const unmemoUpper = await bindTemplate({ ...base, ask: 'BAR CHART of Sales by Region' });
    const { cache: _c, ...cBody } = c;
    expect(cBody).toEqual(unmemoUpper);
  });
});

describe('memo/createMemoizedBinder — propose leg is never cached', () => {
  it('an under-specified ask proposes on every call (no stale bound served)', async () => {
    const binder = createMemoizedBinder();
    const args = { ask: 'hello there friend', workbookXml: SUPERSTORE_XML, manifests: real };
    const first = await binder.bind(args);
    expect(first.status).toBe('propose');
    expect(first.cache.hit).toBe(false);
    const second = await binder.bind(args);
    expect(second.status).toBe('propose');
    expect(second.cache.hit).toBe(false);
  });
});

describe('memo/createMemoizedBinder — validated proposals cached (seconds forever)', () => {
  it('an LLM-legged bind (injected llmPropose) is cached; a later plain ask hits with the identical bound', async () => {
    const binder = createMemoizedBinder();
    const forced = new Map(real);
    const scat = real.get('correlation-scatter-plot-chart')!;
    forced.set('correlation-scatter-plot-chart', {
      ...scat,
      fast_path_eligible: true,
      portability_evidence: { fixture_bind: true, render_verified: 'live-2026-07-04' },
    });
    const proposal: BindingProposal = {
      template: 'correlation-scatter-plot-chart',
      title: 'Profit vs Sales',
      bindings: [
        { slot_id: 'sales', field: 'Sales' },
        { slot_id: 'profit', field: 'Profit' },
        { slot_id: 'customer_name', field: 'Customer Name' },
        { slot_id: 'region', field: 'Region' },
      ],
      confidence: 0.95,
    };
    const ask = 'scatter of Profit vs Sales';

    // Cold: no-LLM misses, injected llmPropose closes the loop → bound (cached).
    const cold = await binder.bind({
      ask,
      workbookXml: SUPERSTORE_XML,
      manifests: forced,
      llmPropose: () => Promise.resolve(proposal),
    });
    expect(cold.status).toBe('bound');
    expect(cold.cache.hit).toBe(false);

    // Warm: the SAME ask, now WITHOUT any llmPropose, hits the cache instantly.
    const warm = await binder.bind({ ask, workbookXml: SUPERSTORE_XML, manifests: forced });
    expect(warm.status).toBe('bound');
    expect(warm.cache.hit).toBe(true);
    const { cache: _cc, ...coldBody } = cold;
    const { cache: _cw, ...warmBody } = warm;
    expect(warmBody).toEqual(coldBody);
  });

  it('a validated Call-2 proposal is cached and served to a subsequent plain ask', async () => {
    const binder = createMemoizedBinder();
    const forced = new Map(real);
    const scat = real.get('correlation-scatter-plot-chart')!;
    forced.set('correlation-scatter-plot-chart', {
      ...scat,
      fast_path_eligible: true,
      portability_evidence: { fixture_bind: true, render_verified: 'live-2026-07-04' },
    });
    const proposal: BindingProposal = {
      template: 'correlation-scatter-plot-chart',
      title: 'Profit vs Sales',
      bindings: [
        { slot_id: 'sales', field: 'Sales' },
        { slot_id: 'profit', field: 'Profit' },
        { slot_id: 'customer_name', field: 'Customer Name' },
        { slot_id: 'region', field: 'Region' },
      ],
      confidence: 0.9,
    };
    const ask = 'scatter of Profit vs Sales';
    const call2 = await binder.bind({
      ask,
      workbookXml: SUPERSTORE_XML,
      manifests: forced,
      proposal,
    });
    expect(call2.status).toBe('bound');

    const plain = await binder.bind({ ask, workbookXml: SUPERSTORE_XML, manifests: forced });
    expect(plain.status).toBe('bound');
    expect(plain.cache.hit).toBe(true);
  });
});

describe('memo/createMemoizedBinder — stale manifest hash misses', () => {
  it('a cache entry keyed on old manifests is not served after manifest content changes', async () => {
    const binder = createMemoizedBinder();
    const ask = 'bar chart of Sales by Region';
    const warmA = await binder.bind({ ask, workbookXml: SUPERSTORE_XML, manifests: real });
    expect(warmA.status).toBe('bound');
    expect(
      (await binder.bind({ ask, workbookXml: SUPERSTORE_XML, manifests: real })).cache.hit,
    ).toBe(true);

    // Same ask, same schema, DIFFERENT manifest content ⇒ different key ⇒ miss.
    const stale = new Map(real);
    const bar = real.get('ranking-ordered-bar')!;
    stale.set('ranking-ordered-bar', { ...bar, fast_path_eligible: false });
    const missed = await binder.bind({ ask, workbookXml: SUPERSTORE_XML, manifests: stale });
    expect(missed.cache.hit).toBe(false);
    // ranking-ordered-bar is now ineligible ⇒ the deterministic result is no longer that bound.
    if (missed.status === 'bound') {
      expect(missed.args.template_name).not.toBe('ranking-ordered-bar');
    }
  });
});

// ── Correctness: memoized === unmemoized across a matrix ────────────────────
describe('memo/createMemoizedBinder — property: memo never changes results', () => {
  type Case = {
    name: string;
    ask: string;
    workbookXml: string;
    manifests: Map<string, TemplateManifest>;
    proposal?: BindingProposal;
  };
  const cases: Case[] = [
    {
      name: 'bound bar (real)',
      ask: 'bar chart of Sales by Region',
      workbookXml: SUPERSTORE_XML,
      manifests: real,
    },
    {
      name: 'bound kpi avg-override (real)',
      ask: 'average O/U Line as a KPI',
      workbookXml: KPI_XML,
      manifests: real,
    },
    {
      name: 'propose under-specified (real)',
      ask: 'hello there friend',
      workbookXml: SUPERSTORE_XML,
      manifests: real,
    },
    {
      name: 'propose scatter ineligible (real)',
      ask: 'scatter of Profit vs Sales',
      workbookXml: SUPERSTORE_XML,
      manifests: real,
    },
    {
      name: 'bound calc-slot template',
      ask: 'calcforce of Sales and Profit',
      workbookXml: SUPERSTORE_XML,
      manifests: CALC_MANIFESTS,
    },
    {
      name: 'bound qualified-key template',
      ask: 'qualkey of Sales',
      workbookXml: SUPERSTORE_XML,
      manifests: QUALKEY_MANIFESTS,
    },
    {
      name: 'call-2 qualified-key proposal',
      ask: 'qualkey of Sales',
      workbookXml: SUPERSTORE_XML,
      manifests: QUALKEY_MANIFESTS,
      proposal: {
        template: 'x-qualkey',
        title: 'Q',
        bindings: [{ slot_id: 'val', field: 'Sales' }],
        confidence: 0.9,
      },
    },
  ];

  for (const c of cases) {
    it(`memoized === unmemoized: ${c.name}`, async () => {
      const args = {
        ask: c.ask,
        workbookXml: c.workbookXml,
        manifests: c.manifests,
        ...(c.proposal ? { proposal: c.proposal } : {}),
      };
      const unmemoized = await bindTemplate(args);
      const binder = createMemoizedBinder();
      const run1 = await binder.bind(args);
      const run2 = await binder.bind(args);
      const strip = (r: Awaited<ReturnType<typeof binder.bind>>): BinderResult => {
        const { cache: _c, ...body } = r;
        return body;
      };
      expect(strip(run1)).toEqual(unmemoized);
      expect(strip(run2)).toEqual(unmemoized);
    });
  }

  it('the calc-slot bound actually exercised a calc-forced input, and the qualified-key bound emitted an @-qualified key', async () => {
    const calcRes = await bindTemplate({
      ask: 'calcforce of Sales and Profit',
      workbookXml: SUPERSTORE_XML,
      manifests: CALC_MANIFESTS,
    });
    expect(calcRes.status).toBe('bound');
    if (calcRes.status === 'bound') {
      // The REQUIRED calc forced the optional m2 slot to bind ⇒ both inputs mapped.
      expect(Object.keys(calcRes.args.field_mapping).sort()).toEqual(['M1', 'M2']);
    }
    const qkRes = await bindTemplate({
      ask: 'qualkey of Sales',
      workbookXml: SUPERSTORE_XML,
      manifests: QUALKEY_MANIFESTS,
    });
    expect(qkRes.status).toBe('bound');
    if (qkRes.status === 'bound') {
      expect(qkRes.args.field_mapping['Sales@sum']).toBe('[Superstore].[sum:Sales:qk]');
    }
  });
});

// ── Speedup: cold (parse+classify) vs warm (cache hit) ─────────────────────
describe('memo/createMemoizedBinder — measured speedup on a repeated bind', () => {
  // A realistically WIDE datasource: the schema-summary parse + classify is the
  // deterministic cost the warm path eliminates.
  function wideWorkbook(nDims: number, nMeas: number): string {
    const cols: string[] = [
      "<column name='[Region]' role='dimension' type='nominal' datatype='string' />",
      "<column name='[Sales]' role='measure' type='quantitative' datatype='real' />",
    ];
    for (let i = 0; i < nDims; i++)
      cols.push(`<column name='[Dim ${i}]' role='dimension' type='nominal' datatype='string' />`);
    for (let i = 0; i < nMeas; i++)
      cols.push(`<column name='[Meas ${i}]' role='measure' type='quantitative' datatype='real' />`);
    return `<?xml version='1.0' encoding='utf-8'?><workbook><datasources><datasource name='Wide'>${cols.join('')}</datasource></datasources></workbook>`;
  }

  it('warm (cache hit) is faster than cold (fresh compute) over N repeats', async () => {
    const N = 300;
    const ask = 'bar chart of Sales by Region';
    const xml = wideWorkbook(150, 150);

    // COLD: a fresh binder per iteration ⇒ every call re-parses XML + classifies.
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      const b = createMemoizedBinder();
      await b.bind({ ask, workbookXml: xml, manifests: real });
    }
    const coldMs = performance.now() - t0;

    // WARM: one binder, primed once ⇒ every subsequent call is a cache hit.
    const warmBinder = createMemoizedBinder();
    await warmBinder.bind({ ask, workbookXml: xml, manifests: real });
    const t1 = performance.now();
    for (let i = 0; i < N; i++) {
      await warmBinder.bind({ ask, workbookXml: xml, manifests: real });
    }
    const warmMs = performance.now() - t1;

    // PORT ADAPTATION: source used console.log; the repo's no-console rule allows warn/error.
    console.warn(
      `[binder-memo] wide-schema(302 fields)  cold ${(coldMs / N).toFixed(4)} ms/bind  warm ${(warmMs / N).toFixed(4)} ms/bind  speedup ${(coldMs / warmMs).toFixed(1)}x`,
    );
    expect(warmMs).toBeLessThan(coldMs);
  });
});
