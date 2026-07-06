import fs from 'fs';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  computeFastPathEligible,
  computeFixtureBind,
  DERIVATIONS,
  isRenderVerifiedLive,
  loadBinderFixture,
  loadManifests,
  MANIFEST_INDEX_PATH,
  MANIFESTS_DIR,
  validateManifest,
} from './manifest.js';
import type { SlotSpec, TemplateManifest } from './manifest-types.js';

// PORT ADAPTATION (source ESM → tableau-mcp CommonJS + packaged data path):
// Source computed XML_DIR from `fileURLToPath(import.meta.url)` (ESM-only). The
// template XML is staged into the target's packaged data dir and resolved from
// `process.cwd()`, matching manifest.ts (see its DATA_DIR note).
const XML_DIR = path.join(
  process.cwd(),
  'src',
  'desktop',
  'data',
  'data-visualization-templates-xml',
);

// Kinds whose template_field is NOT declared as a <column> in the template XML
// (Tableau pseudo-fields like Measure Names, generated geo, parameters).
const NON_COLUMN_KINDS = new Set(['pseudo', 'generated', 'parameter']);

function xmlPath(template: string): string {
  return path.join(XML_DIR, `${template}.xml`);
}

let manifests: Map<string, TemplateManifest>;
let manifestFiles: string[];

beforeAll(() => {
  manifests = loadManifests();
  manifestFiles = fs
    .readdirSync(MANIFESTS_DIR)
    .filter((f) => f.endsWith('.manifest.json'))
    .sort();
});

describe('binder/manifest — loader + shape', () => {
  it('loads every *.manifest.json file', () => {
    expect(manifests.size).toBe(manifestFiles.length);
    expect(manifests.size).toBeGreaterThanOrEqual(14);
  });

  it('keys the cache by template name matching the filename', () => {
    for (const file of manifestFiles) {
      const name = file.slice(0, -'.manifest.json'.length);
      expect(manifests.has(name), `manifest for '${name}' present`).toBe(true);
      expect(manifests.get(name)!.template).toBe(name);
    }
  });

  it('every manifest passes shape validation', () => {
    for (const [name, m] of manifests) {
      expect(validateManifest(m), `${name} shape errors`).toEqual([]);
    }
  });

  it('stored fast_path_eligible equals the design-2.5 predicate', () => {
    for (const [name, m] of manifests) {
      expect(m.fast_path_eligible, `${name}`).toBe(computeFastPathEligible(m));
    }
  });

  it('validateManifest rejects structurally broken manifests', () => {
    const base = manifests.get('ranking-ordered-bar')!;

    const badKind = structuredClone(base) as unknown as { slots: SlotSpec[] };
    (badKind.slots[0] as unknown as { kind: string }).kind = 'bogus';
    expect(validateManifest(badKind).join(' ')).toMatch(/kind/);

    // 'tmn' is now a CANONICAL derivation (H3.2 tmn/tmo reconciliation), so use a
    // genuinely invalid look-alike to exercise the derivation enum check.
    const badDeriv = structuredClone(base) as unknown as { slots: SlotSpec[] };
    (badDeriv.slots[0] as unknown as { derivation: string }).derivation = 'tmonth';
    expect(validateManifest(badDeriv).join(' ')).toMatch(/derivation/);

    const badPredicate = structuredClone(base) as unknown as { fast_path_eligible: boolean };
    badPredicate.fast_path_eligible = false;
    expect(validateManifest(badPredicate).join(' ')).toMatch(/fast_path_eligible/);

    expect(validateManifest(null).length).toBeGreaterThan(0);
    expect(validateManifest({}).length).toBeGreaterThan(0);
  });
});

describe('binder/manifest — first-class CalcSlot fields (H3, backward compatible)', () => {
  // A minimal shape-valid manifest whose single calc references two bindable slots.
  function calcManifest(): TemplateManifest {
    return {
      template: 'x-calc',
      family: 'specialized',
      readiness: 'GREEN',
      fast_path_eligible: true,
      fast_path_blockers: [],
      portability_evidence: { fixture_bind: true, render_verified: 'live-2026-07-04' },
      datasource_placeholder: true,
      placeholders: ['TITLE', 'DATASOURCE'],
      intent_keywords: ['x'],
      description: 'test',
      slots: [
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
          required: true,
        },
      ],
      calcs: [
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
        },
      ],
      hazards: [],
    };
  }

  it('accepts a calc WITHOUT the H3 fields (opaque legacy entry stays valid)', () => {
    expect(validateManifest(calcManifest())).toEqual([]);
  });

  it('accepts a calc WITH inputs, result_role, avoid_when, prereqs populated', () => {
    const m = calcManifest();
    m.calcs[0].result_role = 'measure';
    m.calcs[0].inputs = [
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
    ];
    m.calcs[0].avoid_when = ['inputs are non-numeric strings'];
    m.calcs[0].prereqs = ['min-derivation-per-row'];
    expect(validateManifest(m)).toEqual([]);
  });

  it('rejects an input whose slot_id names no declared slot', () => {
    const m = calcManifest();
    m.calcs[0].inputs = [
      {
        ref: 'M1',
        slot_id: 'does-not-exist',
        slot_kind: 'quantitative',
        required: true,
        template_internal: false,
      },
    ];
    expect(validateManifest(m).join(' ')).toMatch(/inputs.*does-not-exist|does-not-exist/);
  });

  it('rejects an input with an invalid slot_kind', () => {
    const m = calcManifest();
    (m.calcs[0].inputs as unknown) = [
      { ref: 'M1', slot_id: 'm1', slot_kind: 'bogus', required: true, template_internal: false },
    ];
    expect(validateManifest(m).join(' ')).toMatch(/slot_kind/);
  });

  it('rejects an input whose template_internal disagrees with slot_id nullness', () => {
    const m = calcManifest();
    m.calcs[0].inputs = [
      // slot_id present but flagged template_internal — inconsistent.
      {
        ref: 'M1',
        slot_id: 'm1',
        slot_kind: 'quantitative',
        required: true,
        template_internal: true,
      },
    ];
    expect(validateManifest(m).join(' ')).toMatch(/template_internal/);
  });

  it('rejects an invalid result_role', () => {
    const m = calcManifest();
    (m.calcs[0] as unknown as { result_role: string }).result_role = 'metric';
    expect(validateManifest(m).join(' ')).toMatch(/result_role/);
  });
});

describe('binder/manifest — computeFixtureBind proves calc-input binding (H3)', () => {
  // Fixture with exactly ONE numeric measure and one categorical dimension.
  const fields = [
    { name: 'Dim', role: 'dimension' as const, type: 'nominal', datatype: 'string' },
    { name: 'Meas', role: 'measure' as const, type: 'quantitative', datatype: 'real' },
  ];

  // A required calc that depends on an OPTIONAL bindable slot. The optional slot is
  // normally skipped by fixture-bind, but a REQUIRED calc forces its input to bind:
  // with only one measure in the fixture (taken by the required m1 slot), the
  // calc-forced m2 cannot bind → fixture_bind must be FALSE.
  function calcForcesOptionalInput(): TemplateManifest {
    return {
      template: 'x-calc-forced',
      family: 'specialized',
      readiness: 'GREEN',
      fast_path_eligible: false,
      fast_path_blockers: [],
      portability_evidence: { fixture_bind: false, render_verified: 'none' },
      datasource_placeholder: true,
      placeholders: ['TITLE', 'DATASOURCE'],
      intent_keywords: ['x'],
      description: 'test',
      slots: [
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
      calcs: [
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
        },
      ],
      hazards: [],
    };
  }

  it("fails the bind when a REQUIRED calc forces an optional input slot the fixture can't fill", () => {
    expect(computeFixtureBind(calcForcesOptionalInput(), fields)).toBe(false);
  });

  it('passes when the calc is NOT required (its optional input is not forced)', () => {
    const m = calcForcesOptionalInput();
    m.calcs[0].required = false;
    expect(computeFixtureBind(m, fields)).toBe(true);
  });

  it("committed manifests' fixture_bind is unchanged by the calc-input extension", () => {
    // The two calc templates reference REQUIRED bindable slots, so the union
    // (required slots ∪ calc-forced slots) equals the required slots — the stored
    // value must still match a fresh recompute.
    const fixture = loadBinderFixture();
    for (const name of ['ww-floating-bars', 'correlation-scatter-plot-chart']) {
      const m = manifests.get(name)!;
      expect(computeFixtureBind(m, fixture.fields), `${name}`).toBe(
        m.portability_evidence.fixture_bind,
      );
    }
  });
});

describe('binder/manifest — family taxonomy + anti-overlap (attack 2)', () => {
  const TAXONOMY = new Set([
    'time-series',
    'ranking',
    'part-to-whole',
    'correlation',
    'distribution',
    'deviation',
    'magnitude',
    'spatial',
    'kpi',
    'specialized',
  ]);

  it('every manifest declares a family in the closed taxonomy', () => {
    for (const [name, m] of manifests) {
      expect(
        TAXONOMY.has(m.family as string),
        `${name}: family '${m.family}' must be in the taxonomy`,
      ).toBe(true);
    }
  });

  // Within a family, intent_keywords may overlap freely; ACROSS families a keyword
  // that appears in >2 families is a classifier tie-storm hazard and fails here,
  // naming the offender (e.g. the over-generic 'over-time'/'by' collisions).
  it('no intent keyword spans more than two families', () => {
    const kwFamilies = new Map<string, Set<string>>();
    for (const m of manifests.values()) {
      for (const kw of m.intent_keywords) {
        if (!kwFamilies.has(kw)) kwFamilies.set(kw, new Set<string>());
        kwFamilies.get(kw)!.add(m.family);
      }
    }
    const offenders = [...kwFamilies.entries()]
      .filter(([, fams]) => fams.size > 2)
      .map(([kw, fams]) => `${kw} -> {${[...fams].sort().join(', ')}}`);
    expect(offenders, `keywords spanning >2 families: ${offenders.join(' | ')}`).toEqual([]);
  });
});

describe('binder/manifest — portability evidence gate (attacks 5+10)', () => {
  const RENDER_RE = /^(none|live-\d{4}-\d{2}-\d{2})$/;

  it('every manifest carries portability_evidence {fixture_bind, render_verified}', () => {
    for (const [name, m] of manifests) {
      expect(m.portability_evidence, `${name}: portability_evidence present`).toBeDefined();
      expect(typeof m.portability_evidence.fixture_bind, `${name}: fixture_bind boolean`).toBe(
        'boolean',
      );
      expect(
        RENDER_RE.test(m.portability_evidence.render_verified),
        `${name}: render_verified '${m.portability_evidence.render_verified}' must be none|live-YYYY-MM-DD`,
      ).toBe(true);
    }
  });

  it('stored fixture_bind equals a fresh bind against the committed fixture', () => {
    const fixture = loadBinderFixture();
    expect(fixture.fields.length).toBeGreaterThan(0);
    for (const [name, m] of manifests) {
      expect(
        computeFixtureBind(m, fixture.fields),
        `${name}: fixture_bind recompute disagrees with stored`,
      ).toBe(m.portability_evidence.fixture_bind);
    }
  });

  it('fast_path_eligible ⇒ fixture_bind AND a live render-verification stamp', () => {
    for (const [name, m] of manifests) {
      if (!m.fast_path_eligible) continue;
      expect(m.portability_evidence.fixture_bind, `${name}: eligible needs fixture_bind`).toBe(
        true,
      );
      expect(
        isRenderVerifiedLive(m.portability_evidence.render_verified),
        `${name}: eligible needs a live render_verified stamp`,
      ).toBe(true);
    }
  });

  it('the render-verified set is exactly the eight live-proven templates', () => {
    // The W2-R008 wave3 floor-raise (live-verify 2026-07-05) hand-stamped four MORE
    // templates fast_path_eligible after a live render + structural-parity + human
    // review — their provenance rides in portability_evidence.render_evidence (the three
    // shipped-XML siblings) and golden.checkpoint_render (the golden-only ww-ou-arrow):
    //   distribution-bar-code-chart, part-to-whole-stacked-bar-chart, ranking-ordered-column,
    //   ww-ou-arrow.
    // Still UNSTAMPED (render_verified none): ww-ou-diff (a documented derivation that
    // could not be live-render-verified here), ww-floating-bars (recompiled from the final
    // 'format' rung but not yet re-golden-matched), and control-chart-xmr.
    const eligible = [...manifests.values()]
      .filter((m) => m.fast_path_eligible)
      .map((m) => m.template)
      .sort();
    expect(eligible).toEqual(
      [
        'distribution-bar-code-chart',
        'kpi-text',
        'part-to-whole-stacked-bar-chart',
        'part-to-whole-treemap-chart',
        'ranking-ordered-bar',
        'ranking-ordered-column',
        'trend-line-chart',
        'ww-ou-arrow',
      ].sort(),
    );
  });
});

describe('binder/manifest — avoid_when (optional negative-guidance field)', () => {
  it('avoid_when, when present, is a non-empty array of non-empty strings', () => {
    for (const [name, m] of manifests) {
      if (m.avoid_when === undefined) continue;
      expect(Array.isArray(m.avoid_when), `${name}: avoid_when must be an array`).toBe(true);
      expect(
        m.avoid_when.length,
        `${name}: avoid_when must be non-empty when present`,
      ).toBeGreaterThan(0);
      for (const entry of m.avoid_when) {
        expect(typeof entry, `${name}: avoid_when entry must be a string`).toBe('string');
        expect(entry.trim().length, `${name}: avoid_when entry must be non-empty`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it('the anti-pattern templates the review names carry avoid_when guidance', () => {
    // Report Pass-2 §"Top-5 MANIFEST-ENCODE" + structural note: pie and dual-axis
    // carry negative guidance that no positive slot/keyword can encode.
    for (const template of ['part-to-whole-pie-chart', 'correlation-dual-axis-chart']) {
      const m = manifests.get(template);
      expect(m, `${template} manifest present`).toBeDefined();
      expect(m!.avoid_when && m!.avoid_when.length > 0, `${template}: avoid_when populated`).toBe(
        true,
      );
    }
  });
});

describe('binder/manifest — XML cross-checks (XML is ground truth)', () => {
  // GOLDEN-ONLY templates (ww-ou-arrow, ww-ou-diff) are faithfully compiled from a
  // golden .twbx (golden.checkpoint_render) whose worksheet XML is NOT shipped in this
  // package — the <local golden-corpus root> corpus never ships here (see authoring-migration-drift.md).
  // Their gate-earned stamps' provenance rides in golden.checkpoint_render instead. The
  // XML-ground-truth cross-checks below apply only to templates whose .xml SHIPS; golden-only
  // templates get a checkpoint_render provenance assertion (below) in its place. This narrows
  // each check to the ground truth that exists here — it does NOT weaken the assertion logic.
  function hasShippedXml(name: string): boolean {
    return fs.existsSync(xmlPath(name));
  }

  it('every template either ships a matching XML file OR is golden-only with checkpoint_render provenance', () => {
    for (const [name, m] of manifests) {
      if (hasShippedXml(name)) continue;
      expect(
        typeof m.golden?.checkpoint_render === 'string' &&
          m.golden.checkpoint_render.trim().length > 0,
        `${name}: no shipped XML → must declare golden.checkpoint_render provenance`,
      ).toBe(true);
    }
  });

  it('every bindable/calc template_field is declared as a <column> in the XML', () => {
    for (const [name, m] of manifests) {
      if (!hasShippedXml(name)) continue; // golden-only: no shipped XML to cross-check against
      const xml = fs.readFileSync(xmlPath(name), 'utf8');
      const specs: SlotSpec[] = [...m.slots, ...m.calcs];
      for (const spec of specs) {
        if (NON_COLUMN_KINDS.has(spec.kind)) continue;
        const needle = `name='[${spec.template_field}]'`;
        expect(
          xml.includes(needle),
          `${name}: slot '${spec.slot_id}' expects <column ${needle}>`,
        ).toBe(true);
      }
    }
  });

  it('declared placeholders are present in the XML', () => {
    for (const [name, m] of manifests) {
      if (!hasShippedXml(name)) continue; // golden-only: no shipped XML to cross-check against
      const xml = fs.readFileSync(xmlPath(name), 'utf8');
      for (const ph of m.placeholders) {
        expect(xml.includes(`{{${ph}}}`), `${name}: {{${ph}}} present`).toBe(true);
      }
    }
  });

  it('datasource_placeholder reflects {{DATASOURCE}} presence in the XML', () => {
    for (const [name, m] of manifests) {
      if (!hasShippedXml(name)) continue; // golden-only: no shipped XML to cross-check against
      const xml = fs.readFileSync(xmlPath(name), 'utf8');
      expect(m.datasource_placeholder, `${name}`).toBe(xml.includes('{{DATASOURCE}}'));
    }
  });
});

describe('binder/manifest — derivation contract', () => {
  // PORT ADAPTATION: the source asserted every manifest derivation was a key of
  // the injector's canonical derivationMap in `src/server/tools/templates.ts`.
  // That injector/tool layer is Day-2+ (not part of the Day-1 engine port), so
  // this checks the binder's own canonical `Derivation` source of truth
  // (manifest.ts `DERIVATIONS`, which the injector map is a superset of). This is
  // an at-least-as-strict guard; loadManifests() also enforces it at load time.
  it('every slot/calc derivation is a canonical derivation short-form', () => {
    const keys = DERIVATIONS;
    // Sanity: the canonical set is populated.
    expect(keys.has('sum')).toBe(true);
    expect(keys.has('none')).toBe(true);
    for (const [name, m] of manifests) {
      for (const spec of [...m.slots, ...m.calcs]) {
        expect(
          keys.has(spec.derivation),
          `${name}: '${spec.slot_id}' derivation '${spec.derivation}' is canonical`,
        ).toBe(true);
      }
    }
  });

  it('a base field reused at >1 derivation flags qualified_key_required on each slot', () => {
    for (const [name, m] of manifests) {
      const byField = new Map<string, SlotSpec[]>();
      for (const s of m.slots) {
        if (!byField.has(s.template_field)) byField.set(s.template_field, []);
        byField.get(s.template_field)!.push(s);
      }
      for (const [field, group] of byField) {
        const derivations = new Set(group.map((s) => s.derivation));
        if (derivations.size > 1) {
          for (const s of group) {
            expect(
              s.qualified_key_required === true,
              `${name}: '${field}' has ${derivations.size} derivations; slot '${s.slot_id}' must set qualified_key_required`,
            ).toBe(true);
          }
        }
      }
    }
  });
});

describe('binder/manifest — generated index', () => {
  it('data/template-manifests.index.json exists (run the generator first)', () => {
    expect(
      fs.existsSync(MANIFEST_INDEX_PATH),
      'index missing — run `npx tsx src/scripts/buildTemplateManifests.ts`',
    ).toBe(true);
  });

  it('index count and templates equal the sum of the per-file manifests', () => {
    const index = JSON.parse(fs.readFileSync(MANIFEST_INDEX_PATH, 'utf8')) as {
      _generated: boolean;
      count: number;
      templates: TemplateManifest[];
    };
    expect(index._generated).toBe(true);
    expect(index.count).toBe(manifestFiles.length);
    expect(index.templates.length).toBe(manifestFiles.length);

    const fromFiles = manifestFiles
      .map(
        (f) => JSON.parse(fs.readFileSync(path.join(MANIFESTS_DIR, f), 'utf8')) as TemplateManifest,
      )
      .sort((a, b) => a.template.localeCompare(b.template));
    const fromIndex = [...index.templates].sort((a, b) => a.template.localeCompare(b.template));
    expect(fromIndex).toEqual(fromFiles);
  });
});
