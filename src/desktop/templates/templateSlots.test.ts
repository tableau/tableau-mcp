import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bindExplicitTemplate, schemaSummaryFromAvailableFields } from '../binder/explicit-bind.js';
import type { TemplateManifest } from '../binder/manifest-types.js';
import { rewriteFieldReferences } from './fieldReferenceRewriter.js';

// resolveTemplateSlots joins two sources — the inferred `.tbm` and an optional curated
// manifest — so both are mocked. Inference itself (inferFromBookmark/synthesizeManifest)
// runs for real against the fixture, so the merge is exercised end-to-end.
vi.mock('./templatePath.js', () => ({
  getLegacyTemplateCatalogEntry: vi.fn(),
  getTemplateCatalogEntry: vi.fn(),
  listLegacyTemplateCatalog: vi.fn(),
  readBookmarkFromCatalogEntry: vi.fn(),
  readXmlFromCatalogEntry: vi.fn(),
  readBookmark: vi.fn(),
  listTemplateCatalog: vi.fn(),
}));
vi.mock('../intelligence/provider.js', () => ({
  bundledIntelligenceProvider: { getTemplateManifest: vi.fn() },
}));

import { bundledIntelligenceProvider } from '../intelligence/provider.js';
import {
  getLegacyTemplateCatalogEntry,
  getTemplateCatalogEntry,
  listLegacyTemplateCatalog,
  listTemplateCatalog,
  readBookmark,
  readBookmarkFromCatalogEntry,
  readXmlFromCatalogEntry,
} from './templatePath.js';
import {
  resolveAllTemplateCatalog,
  resolveAllTemplateManifests,
  resolveTemplateManifest,
  resolveTemplateSlots,
  resolveTemplateSnapshot,
} from './templateSlots.js';

const readBookmarkMock = vi.mocked(readBookmark);
const readBookmarkFromCatalogEntryMock = vi.mocked(readBookmarkFromCatalogEntry);
const readXmlFromCatalogEntryMock = vi.mocked(readXmlFromCatalogEntry);
const getTemplateCatalogEntryMock = vi.mocked(getTemplateCatalogEntry);
const getLegacyTemplateCatalogEntryMock = vi.mocked(getLegacyTemplateCatalogEntry);
const listTemplateCatalogMock = vi.mocked(listTemplateCatalog);
const listLegacyTemplateCatalogMock = vi.mocked(listLegacyTemplateCatalog);
const getManifestMock = vi.mocked(bundledIntelligenceProvider.getTemplateManifest);

const MODERN_BOOKMARK =
  "<?xml version='1.0'?><bookmark version='10.1'>" +
  "<datasources><datasource name='federated.x' caption='Superstore'>" +
  "<column name='[Sales]' datatype='real' role='measure' type='quantitative'/>" +
  "<column name='[Category]' datatype='string' role='dimension' type='nominal'/>" +
  '</datasource></datasources>' +
  '<table>' +
  '<rows>[federated.x].[none:Category:nk]</rows>' +
  '<cols>[federated.x].[sum:Sales:qk]</cols>' +
  '</table></bookmark>';

const MODERN_CALC_BOOKMARK = readFileSync(
  'src/desktop/data/templates/correlation-scatter-plot-chart.tbm',
  'utf8',
);
const CURATED_CALC_MANIFEST = JSON.parse(
  readFileSync(
    'src/desktop/data/template-manifests/correlation-scatter-plot-chart.manifest.json',
    'utf8',
  ),
) as TemplateManifest;
const CONNECTED_SCATTER_BOOKMARK = readFileSync(
  'src/desktop/data/templates/connected-scatterplot.tbm',
  'utf8',
);
const CONNECTED_SCATTER_MANIFEST = JSON.parse(
  readFileSync('src/desktop/data/template-manifests/connected-scatterplot.manifest.json', 'utf8'),
) as TemplateManifest;

function curatedManifest(overrides: Partial<TemplateManifest> = {}): TemplateManifest {
  return {
    template: 'my-template',
    family: 'specialized',
    readiness: 'GREEN',
    fast_path_eligible: true,
    fast_path_blockers: [],
    portability_evidence: { fixture_bind: true, render_verified: 'none' },
    datasource_placeholder: true,
    placeholders: ['TITLE', 'DATASOURCE'],
    intent_keywords: [],
    description: 'curated',
    slots: [],
    calcs: [],
    hazards: [],
    ...overrides,
  };
}

beforeEach(() => {
  readBookmarkMock.mockReset();
  readBookmarkFromCatalogEntryMock.mockReset();
  listTemplateCatalogMock.mockReset();
  listLegacyTemplateCatalogMock.mockReset();
  getManifestMock.mockReset();
  getTemplateCatalogEntryMock.mockReset();
  getLegacyTemplateCatalogEntryMock.mockReset();
});

describe('resolveTemplateSlots — inferred only (.tbm, no manifest)', () => {
  it('reports source "inferred" and derives slots from the bookmark', () => {
    readBookmarkMock.mockReturnValue(MODERN_BOOKMARK);
    readBookmarkFromCatalogEntryMock.mockReturnValue(MODERN_BOOKMARK);
    getManifestMock.mockReturnValue(undefined);

    const resolved = resolveTemplateSlots('my-template');
    expect(resolved.source).toBe('inferred');
    expect(resolved.fromBookmark).toBe(true);
    expect(resolved.slots.map((s) => s.template_field)).toEqual([
      '{{field_base_1}}',
      '{{field_base_2}}',
    ]);
    // A discovery reference must never carry a concrete donor field name as slot IDENTITY
    // (slot_id/template_field). The `hint` field is exempt — it is labeled suggestion
    // metadata whose whole point is to name the original donor field (asserted below).
    for (const slot of resolved.slots) {
      expect(slot.slot_id).not.toContain('Sales');
      expect(slot.slot_id).not.toContain('Category');
      expect(slot.template_field).not.toContain('Sales');
      expect(slot.template_field).not.toContain('Category');
    }
  });

  it('carries the donor field name as a suggestion hint (not as identity)', () => {
    readBookmarkMock.mockReturnValue(MODERN_BOOKMARK);
    getManifestMock.mockReturnValue(undefined);

    const resolved = resolveTemplateSlots('my-template');
    // These bookmarks carry no <column caption>, so the hint falls back to the base name.
    const hints = resolved.slots.map((s) => s.hint);
    expect(hints).toContain('Sales');
    expect(hints).toContain('Category');
  });
});

describe('resolveTemplateSlots — curated only (manifest, no .tbm)', () => {
  it('reports source "curated" and serves the manifest slots', () => {
    readBookmarkMock.mockReturnValue(null);
    getManifestMock.mockReturnValue(
      curatedManifest({
        slots: [
          {
            slot_id: 'measure',
            template_field: '{{field_base_1}}',
            derivation: 'sum',
            role: ['cols'],
            kind: 'quantitative',
            bindable: true,
            required: true,
            purpose: 'curated measure',
          },
        ],
      }),
    );

    const resolved = resolveTemplateSlots('my-template');
    expect(resolved.source).toBe('curated');
    expect(resolved.fromBookmark).toBe(false);
    expect(resolved.slots).toHaveLength(1);
    expect(resolved.slots[0].purpose).toBe('curated measure');
  });

  it('upgrades to "render-verified" when the manifest carries a live render stamp', () => {
    readBookmarkMock.mockReturnValue(null);
    getManifestMock.mockReturnValue(
      curatedManifest({
        portability_evidence: { fixture_bind: true, render_verified: 'live-2026-07-27' },
      }),
    );
    expect(resolveTemplateSlots('my-template').source).toBe('render-verified');
  });
});

describe('resolveTemplateSlots — both (curated overlays inferred, keyed by template_field)', () => {
  it('lets the curated manifest win per field and fills gaps from inference', () => {
    readBookmarkMock.mockReturnValue(MODERN_BOOKMARK);
    getManifestMock.mockReturnValue(
      curatedManifest({
        slots: [
          {
            slot_id: 'primary-measure',
            template_field: '{{field_base_2}}', // overlays the inferred Sales slot
            derivation: 'sum',
            role: ['cols'],
            kind: 'quantitative',
            bindable: true,
            required: true,
            purpose: 'CURATED PURPOSE',
          },
        ],
      }),
    );

    const resolved = resolveTemplateSlots('my-template');
    expect(resolved.source).toBe('curated');
    expect(resolved.fromBookmark).toBe(true);

    const byField = new Map(resolved.slots.map((s) => [s.template_field, s]));
    // Overlaid field takes the curated slot_id + purpose.
    expect(byField.get('{{field_base_2}}')?.slot_id).toBe('primary-measure');
    expect(byField.get('{{field_base_2}}')?.purpose).toBe('CURATED PURPOSE');
    // The un-overlaid field keeps its inferred purpose.
    expect(byField.get('{{field_base_1}}')).toBeDefined();
    // The curated slot declared no hint, so the inferred donor hint survives the overlay.
    expect(byField.get('{{field_base_2}}')?.hint).toBe('Sales');
  });

  it('lets a curated hint win over the inferred one', () => {
    readBookmarkMock.mockReturnValue(MODERN_BOOKMARK);
    getManifestMock.mockReturnValue(
      curatedManifest({
        slots: [
          {
            slot_id: 'primary-measure',
            template_field: '{{field_base_2}}',
            derivation: 'sum',
            role: ['cols'],
            kind: 'quantitative',
            bindable: true,
            required: true,
            hint: 'Revenue',
          },
        ],
      }),
    );

    const resolved = resolveTemplateSlots('my-template');
    const byField = new Map(resolved.slots.map((s) => [s.template_field, s]));
    expect(byField.get('{{field_base_2}}')?.hint).toBe('Revenue');
  });

  it('appends a curated-only slot with no inferred equivalent', () => {
    readBookmarkMock.mockReturnValue(MODERN_BOOKMARK);
    getManifestMock.mockReturnValue(
      curatedManifest({
        slots: [
          {
            slot_id: 'extra-calc',
            template_field: '{{field_base_9}}', // no inferred counterpart
            derivation: 'none',
            role: ['mark'],
            kind: 'calc',
            bindable: false,
            required: false,
          },
        ],
      }),
    );

    const resolved = resolveTemplateSlots('my-template');
    expect(resolved.slots.map((s) => s.template_field)).toContain('{{field_base_9}}');
    // Inferred slots are preserved alongside the curated extra.
    expect(resolved.slots.length).toBe(3);
  });
});

describe('resolveTemplateSlots — neither', () => {
  it('returns an empty slot set instead of throwing', () => {
    readBookmarkMock.mockReturnValue(null);
    getManifestMock.mockReturnValue(undefined);

    const resolved = resolveTemplateSlots('nonexistent');
    expect(resolved.slots).toEqual([]);
    expect(resolved.fromBookmark).toBe(false);
  });
});

describe('resolveTemplateManifest — full-manifest resolver', () => {
  it('infers a whole manifest from the .tbm when no curated sidecar exists', () => {
    readBookmarkMock.mockReturnValue(MODERN_BOOKMARK);
    getManifestMock.mockReturnValue(undefined);

    const resolved = resolveTemplateManifest('my-template');
    expect(resolved).not.toBeNull();
    expect(resolved!.source).toBe('inferred');
    expect(resolved!.fromBookmark).toBe(true);
    expect(resolved!.manifest.template).toBe('my-template');
    expect(resolved!.manifest.slots.map((s) => s.template_field)).toEqual([
      '{{field_base_1}}',
      '{{field_base_2}}',
    ]);
  });

  it('lets curated top-level metadata win while inference fills omitted fields', () => {
    readBookmarkMock.mockReturnValue(MODERN_BOOKMARK);
    getManifestMock.mockReturnValue(
      curatedManifest({
        family: 'time-series',
        intent_keywords: ['trend', 'over time'],
        avoid_when: ['only one date'],
      }),
    );

    const resolved = resolveTemplateManifest('my-template');
    expect(resolved!.source).toBe('curated');
    expect(resolved!.fromBookmark).toBe(true);
    // Curated metadata wins.
    expect(resolved!.manifest.family).toBe('time-series');
    expect(resolved!.manifest.intent_keywords).toEqual(['trend', 'over time']);
    expect(resolved!.manifest.avoid_when).toEqual(['only one date']);
    // The curated manifest carried an empty slots[] but the .tbm did not, so the merged
    // slot set is the inferred one (mergeSlots union), not the empty curated list.
    expect(resolved!.manifest.slots.map((s) => s.template_field)).toEqual([
      '{{field_base_1}}',
      '{{field_base_2}}',
    ]);
  });

  it('keeps a modern bookmark calc aligned with its inferred slot ids', () => {
    readBookmarkMock.mockReturnValue(MODERN_CALC_BOOKMARK);
    getManifestMock.mockReturnValue(CURATED_CALC_MANIFEST);

    const resolved = resolveTemplateManifest('correlation-scatter-plot-chart');
    const calc = resolved!.manifest.calcs[0];
    const slotIds = new Set(resolved!.manifest.slots.map((slot) => slot.slot_id));

    expect(calc.depends_on_slots).toEqual(['profit_none', 'sales_none']);
    expect(calc.depends_on_slots.every((slotId) => slotIds.has(slotId))).toBe(true);
    expect(calc.inputs).toBeUndefined();
    expect(calc.formula).toBe('SUM([Profit])/SUM([Sales])');
    expect(calc.formula_refs).toEqual(['Profit', 'Sales']);
    expect(calc.result_role).toBe('measure');
    expect(calc.prereqs).toEqual(['raw-formula-refs']);
    expect(resolved!.manifest.portability_evidence.render_verified).toBe('live-2026-07-06');
  });

  it('does not overlay a bundled curated manifest onto a custom bookmark with the same name', () => {
    const entry = {
      template: 'my-template',
      provenance: 'custom',
      overridesLowerPrecedence: true,
      format: 'tbm',
      bookmarkPath: '/contained/my-template.tbm',
    } as const;
    readBookmarkFromCatalogEntryMock.mockReturnValue(MODERN_BOOKMARK);
    getManifestMock.mockReturnValue(
      curatedManifest({
        description: 'BUNDLED DESCRIPTION MUST NOT SURVIVE',
        family: 'ranking',
      }),
    );

    const resolved = resolveTemplateManifest('my-template', entry);

    expect(resolved).toMatchObject({
      source: 'inferred',
      provenance: 'custom',
      overridesLowerPrecedence: true,
    });
    expect(resolved!.manifest.description).toBe('Inferred from bookmark my-template');
    expect(resolved!.manifest.family).toBe('specialized');
  });

  it('serves the curated manifest verbatim when there is no bookmark to infer from', () => {
    readBookmarkMock.mockReturnValue(null);
    getManifestMock.mockReturnValue(curatedManifest({ description: 'manifest-only' }));

    const resolved = resolveTemplateManifest('my-template');
    expect(resolved!.source).toBe('curated');
    expect(resolved!.fromBookmark).toBe(false);
    expect(resolved!.manifest.description).toBe('manifest-only');
  });

  it('returns null when the name resolves to neither a bookmark nor a manifest', () => {
    readBookmarkMock.mockReturnValue(null);
    getManifestMock.mockReturnValue(undefined);
    expect(resolveTemplateManifest('nonexistent')).toBeNull();
  });
});

describe('resolveTemplateSnapshot — one source read', () => {
  it('derives template XML, eligibility, and manifest from the same bookmark bytes', () => {
    const entry = {
      template: 'my-template',
      provenance: 'custom' as const,
      overridesLowerPrecedence: true,
      format: 'tbm' as const,
      bookmarkPath: '/contained/my-template.tbm',
      sourceRoot: '/contained',
    };
    getTemplateCatalogEntryMock.mockReturnValue(entry);
    readBookmarkFromCatalogEntryMock
      .mockReturnValueOnce(MODERN_BOOKMARK)
      .mockReturnValueOnce(MODERN_BOOKMARK.replace('<rows>', '<rows>[federated.x].[sum:Other:qk]'));

    const snapshot = resolveTemplateSnapshot('my-template', { repositoryRoot: '/repository' });

    expect(getTemplateCatalogEntryMock).toHaveBeenCalledWith('my-template', {
      repositoryRoot: '/repository',
    });
    expect(readBookmarkFromCatalogEntryMock).toHaveBeenCalledTimes(1);
    expect(readXmlFromCatalogEntryMock).not.toHaveBeenCalled();
    expect(snapshot).toMatchObject({
      provenance: 'custom',
      overridesLowerPrecedence: true,
      artifact: {
        xml: expect.stringContaining('{{field_base_1}}'),
        eligibility: { pass1_eligible: true, pass1_blockers: [] },
      },
      resolvedManifest: {
        provenance: 'custom',
        overridesLowerPrecedence: true,
      },
    });
    expect(snapshot!.resolvedManifest!.manifest.slots.map((slot) => slot.hint)).toEqual([
      'Category',
      'Sales',
    ]);
  });

  it('does not fall back when an invalid custom source shadows a protected name', () => {
    getTemplateCatalogEntryMock.mockReturnValue({
      template: 'my-template',
      provenance: 'custom',
      overridesLowerPrecedence: true,
      format: 'tbm',
      bookmarkPath: '/contained/my-template.tbm',
      sourceRoot: '/contained',
      discoveryIssue: 'invalid-or-unreadable',
    });
    readBookmarkFromCatalogEntryMock.mockReturnValue(null);

    expect(resolveTemplateSnapshot('my-template')).toBeNull();
    expect(getManifestMock).not.toHaveBeenCalled();
  });

  it('emits Profit divided by Sales from both runtime-canonical scatter bookmarks', () => {
    const templates: Array<{
      name: string;
      bookmark: string;
      manifest: TemplateManifest;
      fieldMapping: Record<string, string>;
    }> = [
      {
        name: 'correlation-scatter-plot-chart',
        bookmark: MODERN_CALC_BOOKMARK,
        manifest: CURATED_CALC_MANIFEST,
        fieldMapping: {
          sales_sum: 'Revenue',
          profit_sum: 'Net Profit',
          customer_name: 'Customer',
          product_name: 'Product',
          sales_none: 'Revenue',
          profit_none: 'Net Profit',
        },
      },
      {
        name: 'connected-scatterplot',
        bookmark: CONNECTED_SCATTER_BOOKMARK,
        manifest: CONNECTED_SCATTER_MANIFEST,
        fieldMapping: {
          profit_sum: 'Net Profit',
          customer_name: 'Customer',
          product_name: 'Product',
          sales: 'Revenue',
          profit_none: 'Net Profit',
        },
      },
    ];
    const schema = schemaSummaryFromAvailableFields([
      {
        datasource: 'Target',
        columnName: '[Revenue]',
        role: 'measure',
        type: 'quantitative',
        datatype: 'real',
        column_ref: '[Target].[sum:Revenue:qk]',
      },
      {
        datasource: 'Target',
        columnName: '[Net Profit]',
        role: 'measure',
        type: 'quantitative',
        datatype: 'real',
        column_ref: '[Target].[sum:Net Profit:qk]',
      },
      {
        datasource: 'Target',
        columnName: '[Customer]',
        role: 'dimension',
        type: 'nominal',
        datatype: 'string',
        column_ref: '[Target].[none:Customer:nk]',
      },
      {
        datasource: 'Target',
        columnName: '[Product]',
        role: 'dimension',
        type: 'nominal',
        datatype: 'string',
        column_ref: '[Target].[none:Product:nk]',
      },
    ]);

    for (const template of templates) {
      readBookmarkFromCatalogEntryMock.mockReturnValue(template.bookmark);
      getManifestMock.mockReturnValue(template.manifest);
      const snapshot = resolveTemplateSnapshot(template.name, {
        catalogEntry: {
          template: template.name,
          provenance: 'protected',
          overridesLowerPrecedence: false,
          format: 'tbm',
        },
      });
      expect(snapshot, template.name).not.toBeNull();

      const manifest = snapshot!.resolvedManifest!.manifest;
      const binding = bindExplicitTemplate(template.name, template.fieldMapping, schema, {
        datasource: 'Target',
        manifests: new Map([[template.name, manifest]]),
      });
      expect(binding.ok, template.name).toBe(true);
      if (!binding.ok) throw new Error(`Binding failed for ${template.name}`);

      const rewritten = rewriteFieldReferences(
        snapshot!.artifact.xml,
        binding.fieldMapping,
        'Target',
        binding.fieldMetadata,
        { templateSlots: binding.templateSlots },
      );
      expect(rewritten, template.name).toMatch(
        /formula=(['"])SUM\(\[Net Profit\]\)\/SUM\(\[Revenue\]\)\1/,
      );
      expect(rewritten, template.name).not.toMatch(/\{\{field_base_\d+\}\}/);
    }
  });
});

describe('resolveAllTemplateManifests — catalog resolver', () => {
  it('maps every listed name to its merged manifest and skips names that resolve to nothing', () => {
    listLegacyTemplateCatalogMock.mockReturnValue([
      {
        template: 'from-tbm',
        provenance: 'protected',
        overridesLowerPrecedence: false,
        format: 'tbm',
      },
      {
        template: 'from-manifest',
        provenance: 'protected',
        overridesLowerPrecedence: false,
        format: 'xml',
      },
      {
        template: 'ghost',
        provenance: 'protected',
        overridesLowerPrecedence: false,
        format: 'xml',
      },
    ]);
    // 'from-tbm' → inferred; 'from-manifest' → curated; 'ghost' → nothing.
    readBookmarkFromCatalogEntryMock.mockImplementation((entry) =>
      entry.template === 'from-tbm' ? MODERN_BOOKMARK : null,
    );
    getManifestMock.mockImplementation((name) =>
      name === 'from-manifest' ? curatedManifest({ template: 'from-manifest' }) : undefined,
    );

    const all = resolveAllTemplateManifests();
    expect([...all.keys()].sort()).toEqual(['from-manifest', 'from-tbm']);
    expect(all.get('from-tbm')?.slots).toHaveLength(2);
    expect(all.get('from-manifest')?.description).toBe('curated');
    expect(all.has('ghost')).toBe(false);
  });

  it('returns an empty map when there are no templates', () => {
    listLegacyTemplateCatalogMock.mockReturnValue([]);
    expect(resolveAllTemplateManifests().size).toBe(0);
  });

  it('preserves protected-provider integrity failures instead of dropping the template', () => {
    listLegacyTemplateCatalogMock.mockReturnValue([
      {
        template: 'protected-template',
        provenance: 'protected',
        overridesLowerPrecedence: false,
        format: 'tbm',
      },
    ]);
    readBookmarkFromCatalogEntryMock.mockImplementation(() => {
      throw new Error('SEA integrity mismatch');
    });

    expect(() => resolveAllTemplateManifests()).toThrow('SEA integrity mismatch');
  });

  it('keeps repository templates out of the legacy manifest catalog', () => {
    listLegacyTemplateCatalogMock.mockReturnValue([]);
    listTemplateCatalogMock.mockReturnValue([
      {
        template: 'external-template',
        provenance: 'bookmark',
        overridesLowerPrecedence: false,
        format: 'tbm',
        bookmarkPath: '/contained/external-template.tbm',
      },
    ]);
    readBookmarkFromCatalogEntryMock.mockReturnValue(MODERN_BOOKMARK);

    expect(resolveAllTemplateManifests().size).toBe(0);
    expect(resolveAllTemplateCatalog().has('external-template')).toBe(true);
  });

  it('drops one unreadable external template without sinking the all-source catalog', () => {
    listTemplateCatalogMock.mockReturnValue([
      {
        template: 'external-template',
        provenance: 'bookmark',
        overridesLowerPrecedence: false,
        format: 'tbm',
        bookmarkPath: '/contained/external-template.tbm',
      },
    ]);
    readBookmarkFromCatalogEntryMock.mockImplementation(() => {
      throw new Error('external file changed');
    });

    expect(resolveAllTemplateCatalog().size).toBe(0);
  });
});
