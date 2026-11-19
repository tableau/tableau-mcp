import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RestApi } from '../../../sdks/tableau/restApi.js';
import type { EvidenceContext } from './evidence.js';

// Each replica is a fresh module graph (its own key-value store state);
// only the provider's backend Map, kept on globalThis by the fixture, is shared between them.
const config = vi.hoisted(() => ({
  keyValueStore: {
    provider: 'custom',
    providerConfig: { module: './src/storage/__fixtures__/sharedBackendKeyValueStore.cjs' },
  } as Record<string, unknown>,
}));
const mocks = vi.hoisted(() => ({ log: vi.fn() }));

vi.mock('../../../config.js', () => ({ getConfig: () => config }));
vi.mock('../../../logging/logger.js', () => ({ log: mocks.log }));

declare global {
  var __sharedKvBackend: Map<string, unknown> | undefined;
  var __sharedKvStoresText: boolean | undefined;
  var __sharedKvStoreDown: boolean | undefined;
  var __sharedKvStoreErrorCode: string | undefined;
  var __sharedKvFailAfterSetPrefix: string | undefined;
}

type EvidenceModule = typeof import('./evidence.js');

async function startReplica(): Promise<EvidenceModule> {
  vi.resetModules();
  const { initializeKeyValueStore } = await import('../../../storage/init.js');
  await initializeKeyValueStore();
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

describe('preview evidence across replicas sharing a custom key-value store', () => {
  beforeEach(() => {
    config.keyValueStore = {
      provider: 'custom',
      providerConfig: { module: './src/storage/__fixtures__/sharedBackendKeyValueStore.cjs' },
    };
    globalThis.__sharedKvBackend = new Map();
    mocks.log.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.__sharedKvBackend = undefined;
    globalThis.__sharedKvStoresText = undefined;
    globalThis.__sharedKvStoreDown = undefined;
    globalThis.__sharedKvStoreErrorCode = undefined;
    globalThis.__sharedKvFailAfterSetPrefix = undefined;
  });

  it('works with a provider that stores values as text', async () => {
    globalThis.__sharedKvStoresText = true;
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

    globalThis.__sharedKvStoreDown = true;
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

  it.each(['secret123', 'SECRET_ACCESS_KEY_ABC123'])(
    'does not log an unrecognized store error code: %s',
    async (code) => {
      const a = await startReplica();
      globalThis.__sharedKvStoreDown = true;
      globalThis.__sharedKvStoreErrorCode = code;

      await expect(new a.RegistryEvidence().establish(makeCtx())).rejects.toThrow(
        'confirmation store is unavailable',
      );
      expect(mocks.log).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Preview evidence store operation failed',
          data: expect.objectContaining({ operation: 'set', errorCode: '<redacted>' }),
        }),
      );
      expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(code);
    },
  );

  it.each(['name', 'code'] as const)(
    'contains a throwing provider error %s getter',
    async (field) => {
      const a = await startReplica();
      const { getKeyValueStore } = await import('../../../storage/init.js');
      const error = Object.defineProperty({}, field, {
        get() {
          throw new Error('LEAK secret-table backend.invalid');
        },
      });
      vi.spyOn(getKeyValueStore(), 'set').mockRejectedValueOnce(error);
      await expect(new a.RegistryEvidence().establish(makeCtx())).rejects.toThrow(
        'confirmation store is unavailable',
      );
      expect(JSON.stringify(mocks.log.mock.calls)).not.toMatch(/LEAK|secret-table|backend.invalid/);
    },
  );

  it.each([
    ['S3ServiceException', '23505'],
    ['Http2Error', 503],
    ['ResourceNotFoundException', 'ECONNREFUSED'],
    ['InternalServerError', 'EAI_AGAIN'],
    ['Throttling', 'ERR_HTTP2_STREAM_ERROR'],
    ['Error', 'NOSCRIPT'],
  ])('logs allowlisted labels (%s, %s)', async (name, code) => {
    const a = await startReplica();
    const { getKeyValueStore } = await import('../../../storage/init.js');
    vi.spyOn(getKeyValueStore(), 'set').mockRejectedValueOnce({ name, code });
    await expect(new a.RegistryEvidence().establish(makeCtx())).rejects.toThrow(
      'confirmation store is unavailable',
    );
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ errorName: name, errorCode: code }),
      }),
    );
  });

  it.each([
    ['SecretTokenAbc123Error', 'ESECRET123'],
    ['Secret123Error', '12345'],
    ['SECRET_ACCESS_KEYError', 'SECRET_ACCESS_KEY_ABC123'],
    ['password=hunter2', 'AKIAIOSFODNN7EXAMPLE'],
    ['Error: host=10.0.0.1:8000', 'secret123'],
    ['arn:aws:dynamodb:table/SECRET', 99999999],
  ])('redacts unknown labels (%s, %s)', async (name, code) => {
    const a = await startReplica();
    const { getKeyValueStore } = await import('../../../storage/init.js');
    vi.spyOn(getKeyValueStore(), 'set').mockRejectedValueOnce({ name, code });
    await expect(new a.RegistryEvidence().establish(makeCtx())).rejects.toThrow(
      'confirmation store is unavailable',
    );
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ errorName: '<redacted>', errorCode: '<redacted>' }),
      }),
    );
    const logCalls = JSON.stringify(mocks.log.mock.calls);
    expect(logCalls).not.toContain(name);
    expect(logCalls).not.toContain(String(code));
  });

  it('fails closed when the store was never initialized', async () => {
    vi.resetModules();
    const a = await import('./evidence.js');
    const { resetKeyValueStore } = await import('../../../storage/init.js');
    resetKeyValueStore();
    await expect(new a.RegistryEvidence().establish(makeCtx())).rejects.toThrow(
      'confirmation store is unavailable',
    );
    await expect(
      new a.RegistryEvidence().verify(
        makeCtx({
          confirmationToken: '00000000-0000-4000-8000-000000000000',
        }),
      ),
    ).rejects.toThrow('confirmation store is unavailable');
    const approval = new a.AppApprovalEvidence('delete-content');
    await expect(approval.establish(makeCtx())).rejects.toThrow(
      'confirmation store is unavailable',
    );
    await expect(approval.verify(makeCtx())).rejects.toThrow('confirmation store is unavailable');
  });

  it('revokes all attempted proof across replicas after a write commits then throws', async () => {
    const a = await startReplica();
    const b = await startReplica();
    const nonce = new a.RegistryEvidence();
    const ctx = makeCtx({ tool: 'delete-content' });
    globalThis.__sharedKvFailAfterSetPrefix = 'mutation-app-approvals-v1:';
    await expect(
      new a.AllEvidence([nonce, new a.AppApprovalEvidence('delete-content')]).establish(ctx),
    ).rejects.toThrow('confirmation store is unavailable');
    expect(globalThis.__sharedKvBackend!.size).toBe(0);
    expect(nonce.getEstablishedNonce()).toBeUndefined();
    await expect(new b.AppApprovalEvidence('delete-content').verify(ctx)).resolves.toBe(false);
  });

  it('logs a failed proof rollback and still revokes the other proof', async () => {
    const a = await startReplica();
    const { getKeyValueStore } = await import('../../../storage/init.js');
    const store = getKeyValueStore();
    const deleteKey = store.delete.bind(store);
    const approvalNamespace = 'mutation-app-approvals-v1';
    vi.spyOn(store, 'delete').mockImplementation(async (key) => {
      if (key.startsWith(`${approvalNamespace}:`)) {
        throw Object.assign(new Error('test rollback failure with private backend details'), {
          code: 'ETIMEDOUT',
        });
      }
      await deleteKey(key);
    });

    globalThis.__sharedKvFailAfterSetPrefix = `${approvalNamespace}:`;
    const ctx = makeCtx({ tool: 'delete-content' });
    const evidence = new a.AllEvidence([
      new a.RegistryEvidence(),
      new a.AppApprovalEvidence('delete-content'),
    ]);

    await expect(evidence.establish(ctx)).rejects.toThrow('confirmation store is unavailable');
    expect([...globalThis.__sharedKvBackend!.keys()]).toEqual([
      expect.stringMatching(/^mutation-app-approvals-v1:/),
    ]);
    expect(mocks.log).toHaveBeenCalledWith({
      message: 'Preview evidence rollback failed; proof may remain until expiry',
      level: 'error',
      logger: 'mutation-guard',
      data: {
        namespace: approvalNamespace,
        operation: 'delete',
        errorName: 'Error',
        errorCode: 'ETIMEDOUT',
      },
    });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('private backend details');
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

  it('expires a nonce even when the provider never applies the per-write TTL', async () => {
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
    globalThis.__sharedKvStoreDown = true;

    const preview = new a.RegistryEvidence();
    await expect(preview.establish(makeCtx())).rejects.toThrow('confirmation store is unavailable');
    expect(preview.getEstablishedNonce()).toBeUndefined();
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('test-password');
  });

  it('keeps proof process-local on the memory provider', async () => {
    config.keyValueStore = { provider: 'memory' };
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

  it('picks up a new provider after the store is reset', async () => {
    config.keyValueStore = { provider: 'memory' };
    const a = await startReplica();
    const { initializeKeyValueStore, resetKeyValueStore } =
      await import('../../../storage/init.js');
    await new a.RegistryEvidence().establish(makeCtx());

    resetKeyValueStore();
    config.keyValueStore = {
      provider: 'custom',
      providerConfig: { module: './src/storage/__fixtures__/sharedBackendKeyValueStore.cjs' },
    };
    await initializeKeyValueStore();
    await new a.RegistryEvidence().establish(makeCtx());
    expect(globalThis.__sharedKvBackend!.size).toBe(1);
  });

  it('stores only hashed keys and an expiry, never the raw nonce or ids', async () => {
    const a = await startReplica();
    const preview = new a.RegistryEvidence();
    await preview.establish(makeCtx());

    const entries = [...globalThis.__sharedKvBackend!.entries()];
    expect(entries).toHaveLength(1);
    const [key, value] = entries[0];
    expect(key).toMatch(/^mutation-confirmation-nonces-v1:[0-9a-f]{64}$/);
    expect(key).not.toContain('flow-1');
    expect(`${key}${String(value)}`).not.toContain(preview.getEstablishedNonce());
    expect(value).toMatch(/^\d+\.[0-9a-f]{64}$/);

    await new a.AppApprovalEvidence('delete-content').establish(makeCtx());
    const approvalKey = [...globalThis.__sharedKvBackend!.keys()].find((entry) =>
      entry.startsWith('mutation-app-approvals-v1:'),
    );
    expect(approvalKey).toMatch(/^mutation-app-approvals-v1:[0-9a-f]{64}$/);
  });
});
