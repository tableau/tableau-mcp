import { describe, expect, it } from 'vitest';

import { loadManifests } from '../binder/manifest.js';
import { BundledIntelligenceProvider } from './provider.js';

const provider = new BundledIntelligenceProvider();

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
  it('listTemplateManifests returns the full bundled set', () => {
    const list = provider.listTemplateManifests();
    expect(list.length).toBe(loadManifests().size);
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
    // then inject-template 404'd. Same move ww-ou-arrow made in W59. The manifest
    // stays fast_path_eligible:false, so shipping XML only enables the inject path.
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
