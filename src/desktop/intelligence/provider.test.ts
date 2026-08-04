import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadManifests } from '../binder/manifest.js';
import { listBookmarkNames } from '../templates/templatePath.js';
import { BundledIntelligenceProvider } from './provider.js';

const provider = new BundledIntelligenceProvider();

// A metadata-free drop-in bookmark: no manifest authored, no tokenized `.xml`.
const DROPPED_IN_BOOKMARK =
  "<?xml version='1.0'?><bookmark version='10.1'>" +
  '<datasources>' +
  "<datasource name='federated.x' caption='Superstore'>" +
  "<column name='[Sales]' datatype='real' role='measure' type='quantitative'/>" +
  "<column name='[Category]' datatype='string' role='dimension' type='nominal'/>" +
  '</datasource>' +
  '</datasources>' +
  '<table>' +
  '<rows>[federated.x].[none:Category:nk]</rows>' +
  '<cols>[federated.x].[sum:Sales:qk]</cols>' +
  '</table>' +
  '</bookmark>';

describe('intelligence/BundledIntelligenceProvider — getStatus', () => {
  it('reports the bundled kind and an HONEST non-exec-fresh posture', () => {
    const s = provider.getStatus();
    expect(s.kind).toBe('bundled');
    expect(s.freshness).toBe('bundled-snapshot');
    // A bundled snapshot must NOT claim to satisfy the exec freshness requirement.
    expect(s.satisfies_exec_freshness).toBe(false);
    expect(s.note).toMatch(/does not satisfy the executive freshness/i);
    expect(s.note).toMatch(/milestone 2/i);
  });

  it('surfaces content_version / schema_version / generated from the content manifest', () => {
    const s = provider.getStatus();
    const cm = provider.getContentManifest();
    expect(s.content_version).toBe(cm.content_version);
    expect(s.schema_version).toBe(cm.schema_version);
    expect(s.generated).toBe(cm.generated);
    // content_version is `<pkgVersion>+content.<YYYY-MM-DD>`.
    expect(s.content_version).toMatch(/^\d+\.\d+\.\d+\+content\.\d{4}-\d{2}-\d{2}$/);
  });
});

describe('intelligence/BundledIntelligenceProvider — getContentManifest', () => {
  it('carries an engine-compat range and a sha256/bytes per bundled resource', () => {
    const cm = provider.getContentManifest();
    expect(cm.engine_compat.server_min).toMatch(/^\d+\.\d+\.\d+$/);
    expect(cm.engine_compat.node.length).toBeGreaterThan(0);
    expect(cm.resources.length).toBeGreaterThan(0);
    for (const r of cm.resources) {
      expect(typeof r.path).toBe('string');
      expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(r.bytes).toBeGreaterThan(0);
    }
    // The generated `_generated`/`_generator` markers are stripped from the served shape.
    expect((cm as unknown as { _generated?: unknown })._generated).toBeUndefined();
  });

  it('hashes every per-template manifest resource', () => {
    const cm = provider.getContentManifest();
    const hashed = new Set(cm.resources.map((r) => r.path));
    for (const name of loadManifests().keys()) {
      expect(
        hashed.has(`template-manifests/${name}.manifest.json`),
        `${name} manifest hashed in content manifest`,
      ).toBe(true);
    }
  });
});

describe('intelligence/BundledIntelligenceProvider — template accessors', () => {
  it('listTemplateManifests returns the full bundled set (curated + `.tbm` drop-ins)', () => {
    const list = provider.listTemplateManifests();
    // Curated manifests union with a synthesized manifest for every `.tbm` bookmark that
    // has no curated manifest — the metadata-free drop-in tier. Derive the expected count
    // from the live sources so adding a bookmark doesn't require editing a magic number.
    const curated = loadManifests();
    const expected = curated.size + listBookmarkNames().filter((n) => !curated.has(n)).length;
    expect(list.length).toBe(expected);
    expect(list.map((m) => m.template)).toContain('ww-ou-arrow');
  });

  it('getTemplateManifest resolves a known template and returns undefined for an unknown one', () => {
    expect(provider.getTemplateManifest('ranking-ordered-bar')?.template).toBe(
      'ranking-ordered-bar',
    );
    expect(provider.getTemplateManifest('does-not-exist')).toBeUndefined();
  });

  it('getTemplateXmlFragment returns shipped XML for a normal template', () => {
    const xml = provider.getTemplateXmlFragment('ranking-ordered-bar');
    expect(xml).not.toBeNull();
    expect(xml!).toMatch(/<worksheet/);
  });

  it('getTemplateXmlFragment ships XML for every manifest (no golden-only orphans)', () => {
    // ww-ou-diff moved to the shipped set with the day-1 vendor sync (2026-07-09):
    // its manifest-without-XML state stranded a live session — the binder offered it,
    // then template construction could not load it. Same move ww-ou-arrow made in W59.
    // The manifest stays fast_path_eligible:false, so shipping XML only enables construction.
    expect(provider.getTemplateManifest('ww-ou-diff')).toBeDefined();
    const xml = provider.getTemplateXmlFragment('ww-ou-diff');
    expect(xml).not.toBeNull();
    expect(xml!).toMatch(/<worksheet/);
  });

  it('getTemplateXmlFragment returns null for an unknown name (no path traversal)', () => {
    expect(provider.getTemplateXmlFragment('../../../etc/passwd')).toBeNull();
    expect(provider.getTemplateXmlFragment('does-not-exist')).toBeNull();
  });
});

describe('intelligence/BundledIntelligenceProvider — metadata-free `.tbm` drop-in', () => {
  const originalTemplatesDir = process.env['TEMPLATES_DIR'];

  afterEach(() => {
    if (originalTemplatesDir === undefined) delete process.env['TEMPLATES_DIR'];
    else process.env['TEMPLATES_DIR'] = originalTemplatesDir;
  });

  it('synthesizes a manifest for a `.tbm` that has no curated manifest', () => {
    const templatesDir = mkdtempSync(join(process.cwd(), 'tmp-provider-tbm-test-'));
    try {
      writeFileSync(join(templatesDir, 'dropped-in-provider-chart.tbm'), DROPPED_IN_BOOKMARK);
      process.env['TEMPLATES_DIR'] = templatesDir;

      const m = provider.getTemplateManifest('dropped-in-provider-chart');
      expect(m?.template).toBe('dropped-in-provider-chart');
      // Honest UNVERIFIED tier for a freshly inferred template.
      expect(m?.readiness).toBe('YELLOW');
      expect(m?.fast_path_eligible).toBe(false);
      expect(m?.portability_evidence?.render_verified).toBe('none');
      // Generic slots, tokenized — never a donor field name.
      expect(m?.slots.length).toBe(2);
      expect(m?.slots.map((s) => s.template_field)).toEqual([
        '{{field_base_1}}',
        '{{field_base_2}}',
      ]);
      for (const s of m!.slots) {
        expect(s.purpose ?? '').not.toContain('Sales');
        expect(s.purpose ?? '').not.toContain('Category');
      }

      // And it unions into the full listing alongside the curated corpus.
      const list = provider.listTemplateManifests();
      expect(list.map((x) => x.template)).toContain('dropped-in-provider-chart');
      expect(list.length).toBe(loadManifests().size + 1);
    } finally {
      rmSync(templatesDir, { recursive: true, force: true });
    }
  });

  it('curated manifest wins — synthesis never shadows a real manifest', () => {
    // A name that already ships a curated manifest must resolve to the CURATED one even
    // when a `.tbm` of the same name is present (the existing 44-template corpus).
    const m = provider.getTemplateManifest('ranking-ordered-bar');
    expect(m?.readiness).not.toBe('YELLOW');
    expect(m?.description).not.toMatch(/^Inferred from bookmark/);
  });
});
