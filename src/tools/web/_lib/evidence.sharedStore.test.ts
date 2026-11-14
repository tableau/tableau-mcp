import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RestApi } from '../../../sdks/tableau/restApi.js';
import type { EvidenceContext } from './evidence.js';

// Each replica is a fresh module graph (its own session store state and memoized proof stores);
// only the provider's backend Map, kept on globalThis by the fixture, is shared between them.
const config = vi.hoisted(() => ({
  sessionStore: {
    provider: 'custom',
    providerConfig: { module: './src/sessionStore/__fixtures__/sharedBackendSessionStore.cjs' },
  } as Record<string, unknown>,
}));
const mocks = vi.hoisted(() => ({ log: vi.fn() }));

vi.mock('../../../config.js', () => ({ getConfig: () => config }));
vi.mock('../../../logging/logger.js', () => ({ log: mocks.log }));

declare global {
  var __sharedSessionBackend: Map<string, unknown> | undefined;
  var __sharedSessionStoresText: boolean | undefined;
  var __sharedSessionStoreDown: boolean | undefined;
}

type EvidenceModule = typeof import('./evidence.js');

async function startReplica(): Promise<EvidenceModule> {
  vi.resetModules();
  return import('./evidence.js');
}

function makeCtx(overrides: Partial<EvidenceContext> = {}): EvidenceContext {
  return {
    restApi: {} as RestApi,
    siteId: 'site-1',
    target: { id: 'flow-1' },
    tool: 'run-flow',
    userLuid: 'user-1',
    ...overrides,
  };
}

describe('preview evidence across replicas sharing a custom session store', () => {
  beforeEach(() => {
    config.sessionStore = {
      provider: 'custom',
      providerConfig: { module: './src/sessionStore/__fixtures__/sharedBackendSessionStore.cjs' },
    };
    globalThis.__sharedSessionBackend = new Map();
    mocks.log.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.__sharedSessionBackend = undefined;
    globalThis.__sharedSessionStoresText = undefined;
    globalThis.__sharedSessionStoreDown = undefined;
  });

  it('works with a provider that stores values as text', async () => {
    globalThis.__sharedSessionStoresText = true;
    const a = await startReplica();
    const b = await startReplica();

    const preview = new a.RegistryEvidence();
    await preview.establish(makeCtx());
    const confirmationToken = preview.getEstablishedNonce();

    await expect(new b.RegistryEvidence().verify(makeCtx({ confirmationToken }))).resolves.toBe(
      true,
    );
  });

  it('rejects a token that is not a nonce it could have minted', async () => {
    const a = await startReplica();
    await new a.RegistryEvidence().establish(makeCtx());

    for (const confirmationToken of ['', 'yes', '../../x', 'a'.repeat(5000)]) {
      await expect(new a.RegistryEvidence().verify(makeCtx({ confirmationToken }))).resolves.toBe(
        false,
      );
    }
  });

  it('fails closed when the store errors on confirm', async () => {
    const a = await startReplica();
    const preview = new a.RegistryEvidence();
    await preview.establish(makeCtx());
    const confirmationToken = preview.getEstablishedNonce();

    globalThis.__sharedSessionStoreDown = true;
    const rejection = new a.RegistryEvidence().verify(makeCtx({ confirmationToken }));
    await expect(rejection).rejects.toThrow('confirmation store is unavailable');
    // The backend's own error text never reaches the client.
    await expect(rejection).rejects.not.toThrow('store down');
    expect(mocks.log).toHaveBeenCalledWith({
      message: 'Preview evidence store operation failed',
      level: 'error',
      logger: 'mutation-guard',
      data: {
        namespace: 'mutation-confirmation-nonces-v1',
        operation: 'consume',
        errorName: 'Error',
        errorCode: 'ECONNREFUSED',
      },
    });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('test-password');
  });

  it('confirms a RegistryEvidence nonce on a different replica, exactly once', async () => {
    const a = await startReplica();
    const b = await startReplica();
    const c = await startReplica();

    const preview = new a.RegistryEvidence();
    await preview.establish(makeCtx());
    const confirmationToken = preview.getEstablishedNonce();

    await expect(new b.RegistryEvidence().verify(makeCtx({ confirmationToken }))).resolves.toBe(
      true,
    );
    // Replay on a third replica: already consumed.
    await expect(new c.RegistryEvidence().verify(makeCtx({ confirmationToken }))).resolves.toBe(
      false,
    );
  });

  it('lets exactly one of two concurrent confirms through', async () => {
    const a = await startReplica();
    const b = await startReplica();
    const c = await startReplica();

    const preview = new a.RegistryEvidence();
    await preview.establish(makeCtx());
    const confirmationToken = preview.getEstablishedNonce();

    const results = await Promise.all([
      new b.RegistryEvidence().verify(makeCtx({ confirmationToken })),
      new c.RegistryEvidence().verify(makeCtx({ confirmationToken })),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('rejects a nonce presented for a different target, user, tool, or binding', async () => {
    const a = await startReplica();
    const b = await startReplica();

    const preview = new a.RegistryEvidence();
    await preview.establish(makeCtx({ binding: 'role=Viewer' }));
    const confirmationToken = preview.getEstablishedNonce();
    const verifier = new b.RegistryEvidence();

    for (const overrides of [
      { target: { id: 'flow-2' } },
      { userLuid: 'user-2' },
      { siteId: 'site-2' },
      { tool: 'run-flow-task' as const },
      { binding: 'role=SiteAdministratorCreator' },
    ]) {
      await expect(
        verifier.verify(makeCtx({ binding: 'role=Viewer', confirmationToken, ...overrides })),
      ).resolves.toBe(false);
    }
    // The mismatched attempts did not burn the real one.
    await expect(
      verifier.verify(makeCtx({ binding: 'role=Viewer', confirmationToken })),
    ).resolves.toBe(true);
  });

  it('only accepts the latest preview of the same target', async () => {
    const a = await startReplica();
    const b = await startReplica();

    const first = new a.RegistryEvidence();
    await first.establish(makeCtx());
    const second = new b.RegistryEvidence();
    await second.establish(makeCtx());

    // One approval, one run: only the latest token confirms.
    await expect(
      new a.RegistryEvidence().verify(makeCtx({ confirmationToken: second.getEstablishedNonce() })),
    ).resolves.toBe(true);
    await expect(
      new a.RegistryEvidence().verify(makeCtx({ confirmationToken: first.getEstablishedNonce() })),
    ).resolves.toBe(false);
  });

  it('a wrong nonce for the right target burns the pending preview', async () => {
    const a = await startReplica();
    const preview = new a.RegistryEvidence();
    await preview.establish(makeCtx());

    await expect(
      new a.RegistryEvidence().verify(
        makeCtx({ confirmationToken: '00000000-0000-4000-8000-000000000000' }),
      ),
    ).resolves.toBe(false);
    await expect(
      new a.RegistryEvidence().verify(
        makeCtx({ confirmationToken: preview.getEstablishedNonce() }),
      ),
    ).resolves.toBe(false);
  });

  it('expires a nonce even when the provider never applies the namespace TTL', async () => {
    vi.useFakeTimers();
    const a = await startReplica();
    const b = await startReplica();

    const preview = new a.RegistryEvidence();
    await preview.establish(makeCtx());
    const confirmationToken = preview.getEstablishedNonce();

    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    await expect(new b.RegistryEvidence().verify(makeCtx({ confirmationToken }))).resolves.toBe(
      false,
    );
  });

  it('confirms an AppApprovalEvidence approval on a different replica, exactly once', async () => {
    const a = await startReplica();
    const b = await startReplica();

    const ctx = makeCtx({ tool: 'delete-content', target: { id: 'wb-1' } });
    await new a.AppApprovalEvidence('delete-content').establish(ctx);

    // The confirm tool runs under a different tool name but shares the namespace.
    const confirmCtx = { ...ctx, tool: 'confirm-delete-content' as EvidenceContext['tool'] };
    await expect(new b.AppApprovalEvidence('delete-content').verify(confirmCtx)).resolves.toBe(
      true,
    );
    await expect(new b.AppApprovalEvidence('delete-content').verify(confirmCtx)).resolves.toBe(
      false,
    );
  });

  it('lets exactly one of two concurrent app-approval confirms through', async () => {
    const a = await startReplica();
    const b = await startReplica();
    const c = await startReplica();

    const ctx = makeCtx({ tool: 'delete-content', target: { id: 'wb-1' } });
    await new a.AppApprovalEvidence('delete-content').establish(ctx);

    const results = await Promise.all([
      new b.AppApprovalEvidence('delete-content').verify(ctx),
      new c.AppApprovalEvidence('delete-content').verify(ctx),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('fails closed when the store errors on preview and returns no nonce', async () => {
    const a = await startReplica();
    globalThis.__sharedSessionStoreDown = true;

    const preview = new a.RegistryEvidence();
    await expect(preview.establish(makeCtx())).rejects.toThrow('confirmation store is unavailable');
    expect(preview.getEstablishedNonce()).toBeUndefined();
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('test-password');
  });

  it('keeps proof process-local on the memory provider', async () => {
    config.sessionStore = { provider: 'memory' };
    const a = await startReplica();
    const b = await startReplica();

    const preview = new a.RegistryEvidence();
    await preview.establish(makeCtx());
    const confirmationToken = preview.getEstablishedNonce();

    await expect(new b.RegistryEvidence().verify(makeCtx({ confirmationToken }))).resolves.toBe(
      false,
    );
    await expect(new a.RegistryEvidence().verify(makeCtx({ confirmationToken }))).resolves.toBe(
      true,
    );
  });

  it('picks up a new provider after the store and proof stores are reset', async () => {
    config.sessionStore = { provider: 'memory' };
    const a = await startReplica();
    const { resetKeyValueStore } = await import('../../../storage/storageProvider.js');
    await new a.RegistryEvidence().establish(makeCtx());

    resetKeyValueStore();
    a.resetPreviewProofStores();
    config.sessionStore = {
      provider: 'custom',
      providerConfig: { module: './src/sessionStore/__fixtures__/sharedBackendSessionStore.cjs' },
    };
    await new a.RegistryEvidence().establish(makeCtx());
    expect(globalThis.__sharedSessionBackend!.size).toBe(1);
  });

  it('stores only hashed keys and an expiry, never the raw nonce or ids', async () => {
    const a = await startReplica();
    const preview = new a.RegistryEvidence();
    await preview.establish(makeCtx());

    const entries = [...globalThis.__sharedSessionBackend!.entries()];
    expect(entries).toHaveLength(1);
    const [key, value] = entries[0];
    expect(key).not.toContain('flow-1');
    expect(`${key}${String(value)}`).not.toContain(preview.getEstablishedNonce());
    expect(value).toMatch(/^\d+\.[0-9a-f]{64}$/);
  });
});
