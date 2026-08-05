import invariant from '../../utils/invariant.js';
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

  it('reserves an artifact for only one concurrent apply and releases it for a safe retry', () => {
    const store = new TemplateArtifactStore({ createId: () => 'artifact-1' });
    store.put('101', artifact('Sales'));

    const first = store.reserve('artifact-1', '101');
    expect(first).toMatchObject({ ok: true, artifact: artifact('Sales') });
    expect(store.reserve('artifact-1', '101')).toEqual({ ok: false, reason: 'in-use' });
    invariant(first.ok);

    expect(store.release(first.reservation)).toBe(true);
    const retry = store.reserve('artifact-1', '101');
    expect(retry).toMatchObject({ ok: true, artifact: artifact('Sales') });
    invariant(retry.ok);
    expect(store.commit(retry.reservation)).toBe(true);
    expect(store.reserve('artifact-1', '101')).toEqual({ ok: false, reason: 'not-found' });
  });

  it('keeps reservation expiry and session binding fail closed', () => {
    let now = 1_000;
    const store = new TemplateArtifactStore({
      now: () => now,
      createId: () => 'artifact-1',
      ttlMs: 100,
    });
    store.put('101:instance-a', artifact('Sales'));

    expect(store.reserve('artifact-1', '101:instance-b')).toEqual({
      ok: false,
      reason: 'session-mismatch',
    });
    now = 1_100;
    expect(store.reserve('artifact-1', '101:instance-a')).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('supersedes an older live artifact for the same session and Desktop instance', () => {
    const ids = ['artifact-a', 'artifact-b'];
    const store = new TemplateArtifactStore({ createId: () => ids.shift()! });
    const identity = templateArtifactSessionIdentity('101', 'instance-a');

    store.put(identity, artifact('First choice'));
    store.put(identity, artifact('Second choice'));

    expect(store.consume('artifact-a', identity)).toEqual({ ok: false, reason: 'not-found' });
    expect(store.consume('artifact-b', identity)).toEqual({
      ok: true,
      artifact: artifact('Second choice'),
    });
  });

  it('invalidates an available live artifact when a new build attempt starts', () => {
    const store = new TemplateArtifactStore({ createId: () => 'artifact-a' });
    const identity = templateArtifactSessionIdentity('101', 'instance-a');
    store.put(identity, artifact('First choice'));

    expect(store.invalidateAvailable(identity)).toBe(1);
    expect(store.consume('artifact-a', identity)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('does not invalidate an in-flight apply or an offline artifact', () => {
    let now = 1_000;
    const ids = ['artifact-a', 'artifact-b', 'offline-a'];
    const store = new TemplateArtifactStore({
      createId: () => ids.shift()!,
      maxCount: 1,
      now: () => now,
      ttlMs: 100,
    });
    const identity = templateArtifactSessionIdentity('101', 'instance-a');
    store.put(identity, artifact('Applying choice'));
    const reservation = store.reserve('artifact-a', identity);
    invariant(reservation.ok);
    now = 1_100;

    store.put(identity, artifact('New choice'));
    expect(store.reserve('artifact-a', identity)).toEqual({ ok: false, reason: 'in-use' });
    expect(store.invalidateAvailable(identity)).toBe(1);
    expect(store.consume('artifact-b', identity)).toEqual({ ok: false, reason: 'not-found' });

    store.put(null, artifact('Offline choice'));
    expect(store.commit(reservation.reservation)).toBe(true);
    expect(store.consume('offline-a', 'any-session')).toEqual({
      ok: true,
      artifact: artifact('Offline choice'),
    });
  });

  it('keeps live artifacts for different session and Desktop identities independent', () => {
    const ids = ['artifact-a', 'artifact-b', 'artifact-c'];
    const store = new TemplateArtifactStore({ createId: () => ids.shift()! });
    const firstIdentity = templateArtifactSessionIdentity('101', 'instance-a');
    const secondIdentity = templateArtifactSessionIdentity('101', 'instance-b');
    const thirdIdentity = templateArtifactSessionIdentity('202', 'instance-a');

    store.put(firstIdentity, artifact('First instance'));
    store.put(secondIdentity, artifact('Second instance'));
    store.put(thirdIdentity, artifact('Second session'));

    expect(store.consume('artifact-a', firstIdentity).ok).toBe(true);
    expect(store.consume('artifact-b', secondIdentity).ok).toBe(true);
    expect(store.consume('artifact-c', thirdIdentity).ok).toBe(true);
  });

  it('keeps offline artifacts independent from live-session supersession', () => {
    const ids = ['live-a', 'offline-a', 'offline-b'];
    const store = new TemplateArtifactStore({ createId: () => ids.shift()! });

    store.put(templateArtifactSessionIdentity('101', 'instance-a'), artifact('Live'));
    store.put(null, artifact('Offline first'));
    store.put(null, artifact('Offline second'));

    expect(store.consume('offline-a', '101:instance-a').ok).toBe(true);
    expect(store.consume('offline-b', 'any-session').ok).toBe(true);
    expect(store.consume('live-a', '101:instance-a').ok).toBe(true);
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
    store.put('101:instance-a', artifact('One'));
    store.put('202:instance-b', artifact('Two'));
    store.put('303:instance-c', artifact('Three'));

    expect(store.consume('artifact-1', '101:instance-a')).toEqual({
      ok: false,
      reason: 'not-found',
    });
    expect(store.consume('artifact-2', '202:instance-b').ok).toBe(true);
    expect(store.consume('artifact-3', '303:instance-c').ok).toBe(true);
  });

  it('scopes stores to one Desktop MCP server owner', () => {
    const firstOwner = {};
    const secondOwner = {};

    expect(getTemplateArtifactStore(firstOwner)).toBe(getTemplateArtifactStore(firstOwner));
    expect(getTemplateArtifactStore(firstOwner)).not.toBe(getTemplateArtifactStore(secondOwner));
  });
});
