import type { TargetWorksheetState } from '../metadata/targetWorksheetState.js';
import {
  getTemplateArtifactStore,
  TemplateArtifactStore,
  type TemplateWorksheetArtifact,
} from './templateArtifactStore.js';

const TARGET_STATE: TargetWorksheetState = {
  worksheetName: 'New Sheet',
  target: { state: 'absent' },
  targetWindow: { state: 'absent' },
  dependenciesSha256: 'ds-hash',
};

function artifact(id: string, sessionId = 'desktop-1'): TemplateWorksheetArtifact {
  return {
    id,
    sessionId,
    instanceId: 'inst-build',
    templateName: 'ranking-ordered-bar',
    templateSourceHash: 'source-hash',
    title: 'New Sheet',
    datasource: 'Superstore',
    fieldMapping: { field_base_1: '[Superstore].[none:Region:nk]' },
    worksheetXml: '<worksheet name="New Sheet"><table /></worksheet>',
    windowXml: '<window class="worksheet" name="New Sheet" />',
    targetState: TARGET_STATE,
  };
}

describe('TemplateArtifactStore', () => {
  it('keeps independent artifacts available and does not expire them with wall time', () => {
    vi.useFakeTimers();
    try {
      const store = new TemplateArtifactStore({ capacity: 4 });
      expect(store.put(artifact('A')).ok).toBe(true);
      expect(store.put(artifact('B')).ok).toBe(true);
      vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000);

      expect(store.reserve('A', 'desktop-1').ok).toBe(true);
      expect(store.reserve('B', 'desktop-1').ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts the least-recently-used available artifact with a specific reason', () => {
    const store = new TemplateArtifactStore({ capacity: 2, tombstoneCapacity: 4 });
    store.put(artifact('A'));
    store.put(artifact('B'));
    const lease = store.reserve('A', 'desktop-1');
    expect(lease.ok).toBe(true);
    if (lease.ok) expect(store.release(lease.lease)).toBe(true);

    expect(store.put(artifact('C')).ok).toBe(true);
    expect(store.reserve('B', 'desktop-1')).toEqual({ ok: false, reason: 'evicted' });
    expect(store.reserve('A', 'desktop-1').ok).toBe(true);
  });

  it('does not consume on a wrong Desktop and distinguishes in-use, consumed, and unknown', () => {
    const store = new TemplateArtifactStore({ capacity: 2 });
    store.put(artifact('A'));

    expect(store.reserve('A', 'desktop-2')).toEqual({
      ok: false,
      reason: 'session-mismatch',
    });
    const lease = store.reserve('A', 'desktop-1');
    expect(lease.ok).toBe(true);
    expect(store.reserve('A', 'desktop-1')).toEqual({ ok: false, reason: 'in-use' });
    if (lease.ok) expect(store.consume(lease.lease)).toBe(true);
    expect(store.reserve('A', 'desktop-1')).toEqual({ ok: false, reason: 'consumed' });
    expect(store.reserve('missing', 'desktop-1')).toEqual({ ok: false, reason: 'unknown' });
  });

  it('releases only the exact active lease and keeps artifact contents immutable', () => {
    const store = new TemplateArtifactStore({ capacity: 2 });
    const source = artifact('A');
    store.put(source);
    source.fieldMapping.field_base_1 = 'mutated-after-put';

    const reserved = store.reserve('A', 'desktop-1');
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    expect(reserved.artifact.fieldMapping.field_base_1).toBe('[Superstore].[none:Region:nk]');
    expect(store.release({ artifactId: 'A', token: 'wrong-token' })).toBe(false);
    expect(store.reserve('A', 'desktop-1')).toEqual({ ok: false, reason: 'in-use' });
    expect(store.release(reserved.lease)).toBe(true);
    expect(store.reserve('A', 'desktop-1').ok).toBe(true);
  });

  it('fails cleanly when capacity is full of reserved artifacts', () => {
    const store = new TemplateArtifactStore({ capacity: 1 });
    store.put(artifact('A'));
    expect(store.reserve('A', 'desktop-1').ok).toBe(true);

    expect(store.put(artifact('B'))).toEqual({ ok: false, reason: 'capacity-in-use' });
    expect(store.reserve('B', 'desktop-1')).toEqual({ ok: false, reason: 'unknown' });
  });

  it('bounds tombstones and degrades an old eviction reason to unknown', () => {
    const store = new TemplateArtifactStore({ capacity: 1, tombstoneCapacity: 1 });
    store.put(artifact('A'));
    store.put(artifact('B'));
    expect(store.reserve('A', 'desktop-1')).toEqual({ ok: false, reason: 'evicted' });
    store.put(artifact('C'));

    expect(store.reserve('A', 'desktop-1')).toEqual({ ok: false, reason: 'unknown' });
    expect(store.reserve('B', 'desktop-1')).toEqual({ ok: false, reason: 'evicted' });
  });

  it('isolates artifacts by server owner even when session identities coincide', () => {
    const ownerA = {};
    const ownerB = {};
    getTemplateArtifactStore(ownerA).put(artifact('A', 'same-session'));

    expect(getTemplateArtifactStore(ownerB).reserve('A', 'same-session')).toEqual({
      ok: false,
      reason: 'unknown',
    });
    expect(getTemplateArtifactStore(ownerA).reserve('A', 'same-session').ok).toBe(true);
  });
});
