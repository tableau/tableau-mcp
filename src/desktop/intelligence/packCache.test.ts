import { describe, expect, it } from 'vitest';

import { evaluateCachedPack, InMemoryPackStore } from './packCache.js';
import { buildCachedPack, fakeVerifier, TEST_ENGINE } from './packFixtures.js';

const TTL_MS = 24 * 60 * 60 * 1000; // 24h
const FETCHED = '2026-07-06T00:00:00.000Z';

function deps(now: Date): Parameters<typeof evaluateCachedPack>[1] {
  return { now, ttlMs: TTL_MS, verifier: fakeVerifier, engine: TEST_ENGINE };
}

describe('packCache/InMemoryPackStore', () => {
  it('round-trips read/write/clear', () => {
    const store = new InMemoryPackStore();
    expect(store.read()).toBeNull();
    const pack = buildCachedPack();
    store.write(pack);
    expect(store.read()).toEqual(pack);
    store.clear();
    expect(store.read()).toBeNull();
  });
});

describe('packCache/evaluateCachedPack — pure state machine', () => {
  it('reports absent when there is no cached pack', () => {
    expect(evaluateCachedPack(null, deps(new Date(FETCHED))).state).toBe('absent');
  });

  it('reports fresh for a verified pack within its TTL', () => {
    const cached = buildCachedPack({ fetched_at: FETCHED });
    const now = new Date('2026-07-06T01:00:00.000Z'); // +1h
    const s = evaluateCachedPack(cached, deps(now));
    expect(s.state).toBe('fresh');
  });

  it('treats the exact TTL boundary as fresh (<= ttl)', () => {
    const cached = buildCachedPack({ fetched_at: FETCHED });
    const now = new Date('2026-07-07T00:00:00.000Z'); // +24h exactly
    expect(evaluateCachedPack(cached, deps(now)).state).toBe('fresh');
  });

  it('reports stale for a verified pack past its TTL', () => {
    const cached = buildCachedPack({ fetched_at: FETCHED });
    const now = new Date('2026-07-07T01:00:00.000Z'); // +25h
    const s = evaluateCachedPack(cached, deps(now));
    expect(s.state).toBe('stale');
  });

  it('reports rejected (never stale) for a tampered cache — integrity beats TTL', () => {
    const cached = buildCachedPack({ fetched_at: FETCHED });
    cached.resources[cached.signedManifest.manifest.resources[0].path] = 'tampered';
    const now = new Date('2026-07-06T01:00:00.000Z');
    const s = evaluateCachedPack(cached, deps(now));
    expect(s.state).toBe('rejected');
    if (s.state === 'rejected') {
      expect(s.reason).toBe('tampered');
    }
  });

  it('reports rejected for a pack with a newer schema_version', () => {
    const cached = buildCachedPack({ manifestOverrides: { schema_version: '2' } });
    const s = evaluateCachedPack(cached, deps(new Date(FETCHED)));
    expect(s.state).toBe('rejected');
    if (s.state === 'rejected') {
      expect(s.reason).toBe('schema-too-new');
    }
  });
});
