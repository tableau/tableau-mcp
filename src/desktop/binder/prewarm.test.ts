import { describe, expect, it } from 'vitest';

import { summarizeSchema } from './binder.js';
import { loadManifests } from './manifest.js';
import type { Family, TemplateManifest } from './manifest-types.js';
import { hashManifests, hashSchemaSummary, SchemaCache } from './memo.js';
import { type FamilyShortlist, prewarmForDatasource, type TemplateShortlist } from './prewarm.js';

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

const real = loadManifests();

function findFamily(
  r: ReturnType<typeof prewarmForDatasource>,
  family: Family,
): FamilyShortlist | undefined {
  return r.families.find((f) => f.family === family);
}
function findTemplate(
  r: ReturnType<typeof prewarmForDatasource>,
  family: Family,
  template: string,
): TemplateShortlist | undefined {
  return findFamily(r, family)?.templates.find((t) => t.template === template);
}

describe('prewarm/prewarmForDatasource', () => {
  it('computes the summary identity (datasource, field count, content hashes)', () => {
    const r = prewarmForDatasource(SUPERSTORE_XML);
    const summary = summarizeSchema(SUPERSTORE_XML);
    expect(r.datasource).toBe('Superstore');
    expect(r.field_count).toBe(summary.fields.length);
    expect(r.schemaHash).toBe(hashSchemaSummary(summary));
    expect(r.manifestHash).toBe(hashManifests(real));
  });

  it('shortlists ONLY fast-path-eligible templates, grouped per family and sorted', () => {
    const r = prewarmForDatasource(SUPERSTORE_XML);
    // Default manifests: eligible = kpi-text, treemap, ranking-ordered-bar, trend-line-chart.
    const fams = r.families.map((f) => f.family);
    expect(fams).toEqual([...fams].sort());
    expect(fams).toContain('ranking');
    expect(fams).toContain('kpi');
    // A render-unverified template (scatter) must not appear anywhere.
    const allTemplates = r.families.flatMap((f) => f.templates.map((t) => t.template));
    expect(allTemplates).toContain('ranking-ordered-bar');
    expect(allTemplates).not.toContain('correlation-scatter-plot-chart');
  });

  it('precomputes per-slot candidate field shortlists by kind', () => {
    const r = prewarmForDatasource(SUPERSTORE_XML);
    const bar = findTemplate(r, 'ranking', 'ranking-ordered-bar');
    expect(bar).toBeDefined();
    const cat = bar!.bindable_slots.find((s) => s.slot_id === 'region');
    const quant = bar!.bindable_slots.find((s) => s.slot_id === 'sales');
    expect(cat!.kind).toBe('categorical');
    expect(cat!.candidate_fields).toContain('Region');
    expect(cat!.candidate_fields).toContain('Category');
    expect(cat!.candidate_fields).not.toContain('Sales');
    expect(quant!.kind).toBe('quantitative');
    expect(quant!.candidate_fields).toContain('Sales');
    expect(quant!.candidate_fields).toContain('Profit');
    expect(quant!.candidate_fields).not.toContain('Region');
  });

  it('is pure/deterministic — two calls are deep-equal', () => {
    expect(prewarmForDatasource(SUPERSTORE_XML)).toEqual(prewarmForDatasource(SUPERSTORE_XML));
  });

  it('accepts a pre-derived SchemaSummary directly', () => {
    const summary = summarizeSchema(SUPERSTORE_XML);
    const r = prewarmForDatasource(summary);
    expect(r.datasource).toBe('Superstore');
    expect(r.schemaHash).toBe(hashSchemaSummary(summary));
  });

  it('warms the shared schema cache so the first real ask is a cache hit', () => {
    const schemaCache = new SchemaCache();
    prewarmForDatasource(SUPERSTORE_XML, { schemaCache });
    expect(schemaCache.get(SUPERSTORE_XML)).toBeDefined();
    // The subsequent read is a hit (no recompute).
    expect(schemaCache.getOrCompute(SUPERSTORE_XML).hit).toBe(true);
  });

  it('honors an injected manifest set (custom eligible templates only)', () => {
    const synth: TemplateManifest = {
      template: 'only-me',
      family: 'distribution',
      readiness: 'GREEN',
      fast_path_eligible: true,
      fast_path_blockers: [],
      portability_evidence: { fixture_bind: true, render_verified: 'live-2026-07-04' },
      datasource_placeholder: true,
      placeholders: ['TITLE', 'DATASOURCE'],
      intent_keywords: ['onlyme'],
      description: 'only eligible template',
      slots: [
        {
          slot_id: 'd',
          template_field: 'D',
          derivation: 'none',
          role: ['rows'],
          kind: 'categorical',
          bindable: true,
          required: true,
        },
        {
          slot_id: 'm',
          template_field: 'M',
          derivation: 'sum',
          role: ['cols'],
          kind: 'quantitative',
          bindable: true,
          required: true,
        },
      ],
      calcs: [],
      hazards: [],
    };
    const ineligible: TemplateManifest = {
      ...synth,
      template: 'not-me',
      fast_path_eligible: false,
    };
    const manifests = new Map([
      ['only-me', synth],
      ['not-me', ineligible],
    ]);
    const r = prewarmForDatasource(SUPERSTORE_XML, { manifests });
    const all = r.families.flatMap((f) => f.templates.map((t) => t.template));
    expect(all).toEqual(['only-me']);
    expect(r.manifestHash).toBe(hashManifests(manifests));
  });
});
