import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TemplateManifest } from '../binder/manifest-types.js';

// resolveTemplateSlots joins two sources — the inferred `.tbm` and an optional curated
// manifest — so both are mocked. Inference itself (inferFromBookmark/synthesizeManifest)
// runs for real against the fixture, so the merge is exercised end-to-end.
vi.mock('./templatePath.js', () => ({ readBookmark: vi.fn() }));
vi.mock('../intelligence/provider.js', () => ({
  bundledIntelligenceProvider: { getTemplateManifest: vi.fn() },
}));

import { bundledIntelligenceProvider } from '../intelligence/provider.js';
import { readBookmark } from './templatePath.js';
import { resolveTemplateSlots } from './templateSlots.js';

const readBookmarkMock = vi.mocked(readBookmark);
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
  getManifestMock.mockReset();
});

describe('resolveTemplateSlots — inferred only (.tbm, no manifest)', () => {
  it('reports source "inferred" and derives slots from the bookmark', () => {
    readBookmarkMock.mockReturnValue(MODERN_BOOKMARK);
    getManifestMock.mockReturnValue(undefined);

    const resolved = resolveTemplateSlots('my-template');
    expect(resolved.source).toBe('inferred');
    expect(resolved.fromBookmark).toBe(true);
    expect(resolved.slots.map((s) => s.template_field)).toEqual([
      '{{field_base_1}}',
      '{{field_base_2}}',
    ]);
    // A discovery reference must never carry a concrete donor field name.
    for (const slot of resolved.slots) {
      expect(JSON.stringify(slot)).not.toContain('Sales');
      expect(JSON.stringify(slot)).not.toContain('Category');
    }
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
