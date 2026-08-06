import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadRuntimeTemplateDescriptors } from '../templates/runtimeTemplateCatalog.js';
import { summarizeSchema } from './binder.js';
import type { Family, RuntimeTemplateDescriptor } from './manifest-types.js';
import { hashManifests, hashSchemaSummary, SchemaCache } from './memo.js';
import { type FamilyShortlist, prewarmForDatasource, type TemplateShortlist } from './prewarm.js';

vi.mock('../templates/runtimeTemplateCatalog.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../templates/runtimeTemplateCatalog.js')>();
  return {
    ...actual,
    loadRuntimeTemplateDescriptors: vi.fn(actual.loadRuntimeTemplateDescriptors),
  };
});

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

const real = loadRuntimeTemplateDescriptors({ automaticOnly: true, includeExternal: false });

const RUNTIME_BOOKMARK = `<?xml version='1.0'?>
<bookmark version='10.1'>
  <datasources>
    <datasource name='runtime.ds'>
      <column name='[Category]' datatype='string' role='dimension' type='nominal'/>
      <column name='[Value]' datatype='real' role='measure' type='quantitative'/>
    </datasource>
  </datasources>
  <table>
    <rows>[runtime.ds].[none:Category:nk]</rows>
    <cols>[runtime.ds].[sum:Value:qk]</cols>
  </table>
</bookmark>`;

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
  it('discovers immutable built-in runtime descriptors only once', () => {
    const loader = vi.mocked(loadRuntimeTemplateDescriptors);
    loader.mockClear();

    prewarmForDatasource(SUPERSTORE_XML);
    prewarmForDatasource(SUPERSTORE_XML);

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('rediscovers external runtime templates on every call', () => {
    const priorTemplatesDir = process.env['TEMPLATES_DIR'];
    const root = mkdtempSync(join(tmpdir(), 'prewarm-runtime-'));
    try {
      process.env['TEMPLATES_DIR'] = root;
      writeFileSync(join(root, 'runtime-first.tbm'), RUNTIME_BOOKMARK);
      const first = prewarmForDatasource(SUPERSTORE_XML);
      writeFileSync(join(root, 'runtime-second.tbm'), RUNTIME_BOOKMARK);
      const second = prewarmForDatasource(SUPERSTORE_XML);

      const firstTemplates = first.families.flatMap((family) =>
        family.templates.map((template) => template.template),
      );
      const secondTemplates = second.families.flatMap((family) =>
        family.templates.map((template) => template.template),
      );
      expect(firstTemplates).toContain('runtime-first');
      expect(firstTemplates).not.toContain('runtime-second');
      expect(secondTemplates).toContain('runtime-second');
    } finally {
      if (priorTemplatesDir === undefined) delete process.env['TEMPLATES_DIR'];
      else process.env['TEMPLATES_DIR'] = priorTemplatesDir;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refreshes repository templates without reloading protected descriptors', () => {
    const priorRepositoryDir = process.env['TABLEAU_REPOSITORY_DIR'];
    const priorTemplatesDir = process.env['TEMPLATES_DIR'];
    const root = mkdtempSync(join(tmpdir(), 'prewarm-repository-'));
    const custom = join(root, 'Tableau Agent', 'templates');
    mkdirSync(join(custom, '.vendored', 'overridable'), { recursive: true });
    const loader = vi.mocked(loadRuntimeTemplateDescriptors);
    try {
      delete process.env['TABLEAU_REPOSITORY_DIR'];
      delete process.env['TEMPLATES_DIR'];
      prewarmForDatasource(SUPERSTORE_XML);
      loader.mockClear();
      process.env['TABLEAU_REPOSITORY_DIR'] = root;
      writeFileSync(join(custom, 'repository-first.tbm'), RUNTIME_BOOKMARK);
      const first = prewarmForDatasource(SUPERSTORE_XML);
      writeFileSync(join(custom, 'repository-second.tbm'), RUNTIME_BOOKMARK);
      const second = prewarmForDatasource(SUPERSTORE_XML);
      writeFileSync(join(custom, 'ranking-ordered-bar.tbm'), '<not-a-bookmark/>');
      const withInvalidOverride = prewarmForDatasource(SUPERSTORE_XML);

      const firstTemplates = first.families.flatMap((family) =>
        family.templates.map((template) => template.template),
      );
      const secondTemplates = second.families.flatMap((family) =>
        family.templates.map((template) => template.template),
      );
      const invalidOverrideTemplates = withInvalidOverride.families.flatMap((family) =>
        family.templates.map((template) => template.template),
      );
      expect(firstTemplates).toContain('ranking-ordered-bar');
      expect(firstTemplates).toContain('repository-first');
      expect(firstTemplates).not.toContain('repository-second');
      expect(secondTemplates).toContain('repository-second');
      expect(invalidOverrideTemplates).not.toContain('ranking-ordered-bar');
      expect(loader.mock.calls).toEqual([
        [{ automaticOnly: true, includeProtected: false }],
        [{ automaticOnly: true, includeProtected: false }],
        [{ automaticOnly: true, includeProtected: false }],
      ]);
    } finally {
      if (priorRepositoryDir === undefined) delete process.env['TABLEAU_REPOSITORY_DIR'];
      else process.env['TABLEAU_REPOSITORY_DIR'] = priorRepositoryDir;
      if (priorTemplatesDir === undefined) delete process.env['TEMPLATES_DIR'];
      else process.env['TEMPLATES_DIR'] = priorTemplatesDir;
      rmSync(root, { recursive: true, force: true });
    }
  });

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
    const fams = r.families.map((f) => f.family);
    expect(fams).toEqual([...fams].sort());
    expect(fams).toContain('ranking');
    expect(fams).toContain('kpi');
    const allTemplates = r.families.flatMap((f) => f.templates.map((t) => t.template));
    expect(allTemplates).toContain('ranking-ordered-bar');
    expect(allTemplates).toContain('correlation-scatter-plot-chart');
    expect(allTemplates).toContain('connected-scatterplot');
    for (const template of allTemplates) {
      expect(real.get(template)?.fast_path_eligible, template).toBe(true);
    }
  });

  it('precomputes per-slot candidate field shortlists by kind', () => {
    const r = prewarmForDatasource(SUPERSTORE_XML);
    const bar = findTemplate(r, 'ranking', 'ranking-ordered-bar');
    expect(bar).toBeDefined();
    const cat = bar!.bindable_slots.find((s) => s.kind === 'categorical');
    const quant = bar!.bindable_slots.find((s) => s.kind === 'quantitative');
    expect(cat).toBeDefined();
    expect(quant).toBeDefined();
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
    const synth: RuntimeTemplateDescriptor = {
      template: 'only-me',
      family: 'distribution',
      fast_path_eligible: true,
      fast_path_blockers: [],
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
    };
    const ineligible: RuntimeTemplateDescriptor = {
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
