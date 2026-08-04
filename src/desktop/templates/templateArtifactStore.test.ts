import type { WorksheetApplyState } from '../metadata/targetWorksheetState.js';
import {
  getTemplateArtifactStore,
  type TemplateArtifact,
  templateArtifactSessionIdentity,
  TemplateArtifactStore,
} from './templateArtifactStore.js';

const STATE: WorksheetApplyState = {
  target: { state: 'absent' },
  targetWindow: { state: 'absent' },
  dependenciesSha256: 'c'.repeat(64),
  artifactSha256: 'd'.repeat(64),
};

function artifact(name: string): TemplateArtifact {
  return {
    worksheetName: name,
    worksheetXml: `<worksheet name="${name}" />`,
    worksheetWindowXml: `<window class="worksheet" name="${name}" />`,
    expectedState: STATE,
    templateProvenance: 'protected',
    metadataTrust: 'trusted-protected-or-dev' as const,
  };
}

describe('TemplateArtifactStore', () => {
  it('binds live artifacts to both the resolved session and Desktop instance', () => {
    expect(templateArtifactSessionIdentity('101', 'instance-a')).toBe('101:instance-a');
    expect(templateArtifactSessionIdentity('101', undefined)).toBe('101');
  });

  it('consumes an exact artifact once only for its bound session', () => {
    const store = new TemplateArtifactStore({ createId: () => 'artifact-1' });
    store.put('101', artifact('Sales'));

    expect(store.consume('artifact-1', '202')).toEqual({
      ok: false,
      reason: 'session-mismatch',
    });
    expect(store.consume('artifact-1', '101')).toEqual({
      ok: true,
      artifact: artifact('Sales'),
    });
    expect(store.consume('artifact-1', '101')).toEqual({ ok: false, reason: 'not-found' });
  });

  it('expires artifacts after the configured TTL', () => {
    let now = 1_000;
    const store = new TemplateArtifactStore({
      now: () => now,
      createId: () => 'artifact-1',
      ttlMs: 100,
    });
    expect(store.put('101', artifact('Sales')).expiresAt).toBe(1_100);

    now = 1_100;
    expect(store.consume('artifact-1', '101')).toEqual({ ok: false, reason: 'expired' });
  });

  it('evicts the oldest artifact before exceeding its count bound', () => {
    const ids = ['artifact-1', 'artifact-2', 'artifact-3'];
    const store = new TemplateArtifactStore({
      createId: () => ids.shift()!,
      maxCount: 2,
    });
    store.put('101', artifact('One'));
    store.put('101', artifact('Two'));
    store.put('101', artifact('Three'));

    expect(store.consume('artifact-1', '101')).toEqual({ ok: false, reason: 'not-found' });
    expect(store.consume('artifact-2', '101').ok).toBe(true);
    expect(store.consume('artifact-3', '101').ok).toBe(true);
  });

  it('scopes stores to one Desktop MCP server owner', () => {
    const firstOwner = {};
    const secondOwner = {};

    expect(getTemplateArtifactStore(firstOwner)).toBe(getTemplateArtifactStore(firstOwner));
    expect(getTemplateArtifactStore(firstOwner)).not.toBe(getTemplateArtifactStore(secondOwner));
  });
});
