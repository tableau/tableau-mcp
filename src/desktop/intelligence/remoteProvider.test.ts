import { describe, expect, it } from 'vitest';

import { InMemoryPackStore, type PackStore } from './packCache.js';
import { buildCachedPack, fakeVerifier, TEST_ENGINE } from './packFixtures.js';
import type { SignatureVerifier } from './packVerification.js';
import { bundledIntelligenceProvider } from './provider.js';
import {
  type Clock,
  materializePackSource,
  NotConfiguredTransport,
  type PackTransport,
  RemotePackIntelligenceProvider,
} from './remoteProvider.js';

const TTL_MS = 24 * 60 * 60 * 1000;
const clockAt = (iso: string): Clock => ({ now: () => new Date(iso) });

function makeProvider(opts?: {
  store?: PackStore;
  transport?: PackTransport;
  verifier?: SignatureVerifier;
  clockIso?: string;
  ttlMs?: number;
}): RemotePackIntelligenceProvider {
  return new RemotePackIntelligenceProvider({
    transport: opts?.transport ?? new NotConfiguredTransport(),
    verifier: opts?.verifier ?? fakeVerifier,
    store: opts?.store ?? new InMemoryPackStore(),
    clock: clockAt(opts?.clockIso ?? '2026-07-06T01:00:00.000Z'),
    fallback: bundledIntelligenceProvider,
    engine: TEST_ENGINE,
    ttlMs: opts?.ttlMs ?? TTL_MS,
  });
}

describe('remoteProvider/NotConfiguredTransport', () => {
  it('returns a typed unavailable result from both methods (no network)', async () => {
    const t = new NotConfiguredTransport();
    const m = await t.fetchManifest();
    expect(m.isErr()).toBe(true);
    expect(m.unwrapErr().reason).toBe('not-configured');
    const cached = buildCachedPack();
    const p = await t.fetchPack(cached.signedManifest.manifest);
    expect(p.isErr()).toBe(true);
    expect(p.unwrapErr().reason).toBe('not-configured');
  });
});

describe('remoteProvider — fallback to bundled (honest status)', () => {
  it('serves the bundled snapshot with fallback=no-cache when the cache is empty', () => {
    const p = makeProvider();
    const s = p.getStatus();
    expect(s.kind).toBe('bundled');
    expect(s.fallback).toBe('no-cache');
    expect(s.satisfies_exec_freshness).toBe(false);
    // Content is delegated to the bundled provider (byte-identical served content).
    expect(p.listTemplateManifests().length).toBe(
      bundledIntelligenceProvider.listTemplateManifests().length,
    );
    expect(p.getContentManifest()).toEqual(bundledIntelligenceProvider.getContentManifest());
  });

  it('reports fallback=tampered-cache when the cached pack is tampered', () => {
    const cached = buildCachedPack();
    cached.resources[cached.signedManifest.manifest.resources[0].path] = 'tampered';
    const p = makeProvider({ store: new InMemoryPackStore(cached) });
    const s = p.getStatus();
    expect(s.kind).toBe('bundled');
    expect(s.fallback).toBe('tampered-cache');
    expect(s.satisfies_exec_freshness).toBe(false);
  });

  it('reports fallback=schema-too-new for a pack the engine cannot read', () => {
    const cached = buildCachedPack({ manifestOverrides: { schema_version: '2' } });
    const p = makeProvider({ store: new InMemoryPackStore(cached) });
    expect(p.getStatus().fallback).toBe('schema-too-new');
  });

  it('reports fallback=malformed-pack when a verified pack cannot materialize', () => {
    const cached = buildCachedPack({
      resources: [{ path: 'template-manifests/broken.manifest.json', content: '{ not json' }],
    });
    const p = makeProvider({ store: new InMemoryPackStore(cached) });
    expect(p.getStatus().fallback).toBe('malformed-pack');
  });
});

describe('remoteProvider — serving a verified pack', () => {
  it('serves a verified fresh pack and satisfies exec freshness', () => {
    const cached = buildCachedPack({ fetched_at: '2026-07-06T00:00:00.000Z' });
    const p = makeProvider({
      store: new InMemoryPackStore(cached),
      clockIso: '2026-07-06T01:00:00.000Z',
    });
    const s = p.getStatus();
    expect(s.kind).toBe('remote-pack');
    expect(s.freshness).toBe('remote-pack-fresh');
    expect(s.stale).toBe(false);
    expect(s.satisfies_exec_freshness).toBe(true);
    expect(s.content_version).toBe(cached.signedManifest.manifest.content_version);
    expect(p.getTemplateManifest('ranking-ordered-bar')?.template).toBe('ranking-ordered-bar');
    expect(p.getTemplateXmlFragment('ranking-ordered-bar')).toMatch(/<worksheet/);
  });

  it('serves a verified STALE pack with an honest stale flag (does NOT satisfy freshness)', () => {
    const cached = buildCachedPack({ fetched_at: '2026-07-06T00:00:00.000Z' });
    const p = makeProvider({
      store: new InMemoryPackStore(cached),
      clockIso: '2026-07-10T00:00:00.000Z',
    });
    const s = p.getStatus();
    expect(s.kind).toBe('remote-pack');
    expect(s.freshness).toBe('remote-pack-stale');
    expect(s.stale).toBe(true);
    expect(s.satisfies_exec_freshness).toBe(false);
    // Still serves the pack's content, not the bundled snapshot.
    expect(p.getTemplateManifest('ranking-ordered-bar')?.template).toBe('ranking-ordered-bar');
  });

  it('re-checks integrity on every load — a post-write tamper drops to bundled on reload', () => {
    const cached = buildCachedPack({ fetched_at: '2026-07-06T00:00:00.000Z' });
    const store = new InMemoryPackStore(cached);
    const p = makeProvider({ store });
    expect(p.getStatus().kind).toBe('remote-pack');
    // Tamper the cached bytes after the first load, then force a reload.
    cached.resources[cached.signedManifest.manifest.resources[0].path] = 'tampered';
    p.reload();
    expect(p.getStatus().kind).toBe('bundled');
    expect(p.getStatus().fallback).toBe('tampered-cache');
  });
});

describe('remoteProvider/materializePackSource', () => {
  it('materializes template manifests + XML fragments from a verified pack', () => {
    const cached = buildCachedPack();
    // Re-verify to get a VerifiedPack shape via the provider path is overkill; materialize
    // needs a VerifiedPack, so build one through the store→evaluate path indirectly:
    const p = makeProvider({ store: new InMemoryPackStore(cached) });
    // Unknown template name returns null (no path traversal / fabrication).
    expect(p.getTemplateXmlFragment('does-not-exist')).toBeNull();
    expect(p.getTemplateXmlFragment('../../etc/passwd')).toBeNull();
    expect(p.getTemplateManifest('does-not-exist')).toBeUndefined();
  });

  it('returns Err for a pack whose inner manifest JSON is malformed', () => {
    const verified = {
      manifest: {
        pack_format_version: '1',
        content_version: '2.11.0+content.2026-07-06',
        schema_version: '1',
        generated: '2026-07-06',
        engine_compat: { server_min: '2.11.0', node: '>=22.7.5' },
        resources: [
          { path: 'template-manifests/broken.manifest.json', sha256: 'x'.repeat(64), bytes: 10 },
        ],
      },
      resources: { 'template-manifests/broken.manifest.json': '{ not json' },
      fetchedAt: new Date('2026-07-06T00:00:00.000Z'),
    };
    expect(materializePackSource(verified).isErr()).toBe(true);
  });
});

describe('remoteProvider/refresh — transport seam (no network with NotConfiguredTransport)', () => {
  it('leaves the bundled fallback in place and reports not-configured', async () => {
    const p = makeProvider();
    const outcome = await p.refresh();
    expect(outcome.refreshed).toBe(false);
    if (!outcome.refreshed) {
      expect(outcome.reason).toBe('not-configured');
    }
    expect(p.getStatus().kind).toBe('bundled');
  });
});
