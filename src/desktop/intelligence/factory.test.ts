import { describe, expect, it } from 'vitest';

import { getIntelligenceProvider, parseIntelligenceConfig } from './factory.js';
import { InMemoryPackStore } from './packCache.js';
import { buildCachedPack, fakeVerifier, TEST_ENGINE } from './packFixtures.js';
import { bundledIntelligenceProvider } from './provider.js';
import { RemotePackIntelligenceProvider } from './remoteProvider.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('factory/parseIntelligenceConfig — watch-class config boundary', () => {
  it('defaults to bundled with a 24h TTL when nothing is set', () => {
    const c = parseIntelligenceConfig({});
    expect(c.mode).toBe('bundled');
    expect(c.ttlMs).toBe(DAY_MS);
  });

  it('enables remote only on the exact opt-in value', () => {
    expect(parseIntelligenceConfig({ AUTHORING_CONTENT_PACK_MODE: 'remote' }).mode).toBe('remote');
    expect(parseIntelligenceConfig({ AUTHORING_CONTENT_PACK_MODE: 'bundled' }).mode).toBe(
      'bundled',
    );
  });

  it('fails closed to bundled for an unrecognized mode and records it', () => {
    const c = parseIntelligenceConfig({ AUTHORING_CONTENT_PACK_MODE: 'REMOTE' });
    expect(c.mode).toBe('bundled');
    expect(c.invalidMode).toBe('REMOTE');
  });

  it('parses a positive TTL and falls back to the default for garbage', () => {
    expect(parseIntelligenceConfig({ AUTHORING_CONTENT_PACK_TTL_HOURS: '48' }).ttlMs).toBe(
      48 * 60 * 60 * 1000,
    );
    expect(parseIntelligenceConfig({ AUTHORING_CONTENT_PACK_TTL_HOURS: 'abc' }).ttlMs).toBe(DAY_MS);
    expect(parseIntelligenceConfig({ AUTHORING_CONTENT_PACK_TTL_HOURS: '-3' }).ttlMs).toBe(DAY_MS);
  });
});

describe('factory/getIntelligenceProvider — selection', () => {
  it('returns the EXACT bundled singleton for the default config (byte-identical)', () => {
    const provider = getIntelligenceProvider(parseIntelligenceConfig({}));
    expect(provider).toBe(bundledIntelligenceProvider);
  });

  it('remote mode with shipped defaults still serves the bundled snapshot (no pack, no network)', () => {
    const provider = getIntelligenceProvider({ mode: 'remote', ttlMs: DAY_MS });
    expect(provider).toBeInstanceOf(RemotePackIntelligenceProvider);
    const s = provider.getStatus();
    expect(s.kind).toBe('bundled');
    expect(s.fallback).toBe('no-cache');
    expect(provider.getContentManifest()).toEqual(bundledIntelligenceProvider.getContentManifest());
  });

  it('remote mode wires injected deps through to serve a verified pack', () => {
    const cached = buildCachedPack({ fetched_at: '2026-07-06T00:00:00.000Z' });
    const provider = getIntelligenceProvider(
      { mode: 'remote', ttlMs: DAY_MS },
      {
        store: new InMemoryPackStore(cached),
        verifier: fakeVerifier,
        engine: TEST_ENGINE,
        clock: { now: () => new Date('2026-07-06T01:00:00.000Z') },
      },
    );
    expect(provider.getStatus().kind).toBe('remote-pack');
    expect(provider.getStatus().satisfies_exec_freshness).toBe(true);
  });
});
