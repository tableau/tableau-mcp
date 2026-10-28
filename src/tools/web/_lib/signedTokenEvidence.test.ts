import { afterEach } from 'vitest';

import { RestApi } from '../../../sdks/tableau/restApi.js';
import { InMemorySessionStore } from '../../../sessionStore/inMemorySessionStore.js';
import { EvidenceContext } from './evidence.js';
import { SignedTokenEvidence } from './signedTokenEvidence.js';

// Pending evidence is module state, so each test gets its own target.
let n = 0;

function makeCtx(overrides: Partial<EvidenceContext> = {}): EvidenceContext {
  return {
    restApi: { siteId: 'site-1' } as unknown as RestApi,
    siteId: 'site-1',
    target: { id: `flow-${n}` },
    tool: 'run-flow',
    userLuid: 'user-1',
    ...overrides,
  };
}

async function mint(ctx: EvidenceContext): Promise<string> {
  const evidence = new SignedTokenEvidence();
  await evidence.establish(ctx);
  return evidence.getEstablishedNonce()!;
}

// Tool instances share a process; separate module graphs below stand in for replicas.
const verify = (ctx: EvidenceContext): Promise<boolean> => new SignedTokenEvidence().verify(ctx);

describe('SignedTokenEvidence', () => {
  beforeEach(() => {
    n++;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('verifies a token minted by another instance', async () => {
    const token = await mint(makeCtx());
    expect(await verify(makeCtx({ confirmationToken: token }))).toBe(true);
  });

  it('accepts a token once across tool instances', async () => {
    const confirm = makeCtx({ confirmationToken: await mint(makeCtx()) });
    expect(await verify(confirm)).toBe(true);
    expect(await verify(confirm)).toBe(false);
  });

  it.each([
    ['site', { siteId: 'site-2' }],
    ['user', { userLuid: 'user-2' }],
    ['tool', { tool: 'cancel-flow-run' as const }],
    ['target', { target: { id: 'other' } }],
    ['binding', { binding: 'other' }],
  ])('rejects a token used for a different %s', async (_name, override) => {
    const token = await mint(makeCtx({ binding: 'b' }));
    expect(await verify(makeCtx({ binding: 'b', ...override, confirmationToken: token }))).toBe(
      false,
    );
  });

  it('rejects a token whose fields shift across a delimiter', async () => {
    const token = await mint(makeCtx({ target: { id: `flow-${n}:x` }, binding: 'y' }));
    expect(
      await verify(
        makeCtx({ target: { id: `flow-${n}` }, binding: 'x:y', confirmationToken: token }),
      ),
    ).toBe(false);
  });

  it('rejects missing, malformed and tampered tokens', async () => {
    const token = await mint(makeCtx());
    const [expiry, nonce, signature] = token.split('-');
    const bad = [
      undefined,
      '',
      'garbage',
      `${expiry}-`,
      `${expiry}-${nonce}-${'0'.repeat(64)}`,
      `${Number(expiry) + 1}-${nonce}-${signature}`,
      `${expiry}-${'0'.repeat(32)}-${signature}`,
      `${token}-x`,
    ];
    for (const confirmationToken of bad) {
      expect(await verify(makeCtx({ confirmationToken }))).toBe(false);
    }
  });

  it('rejects an expired token', async () => {
    vi.useFakeTimers();
    const token = await mint(makeCtx());
    vi.advanceTimersByTime(6 * 60 * 1000);
    expect(await verify(makeCtx({ confirmationToken: token }))).toBe(false);
  });

  it('does not recreate a consumed token when previewing again in the same millisecond', async () => {
    vi.useFakeTimers();
    const ctx = makeCtx();
    const first = await mint(ctx);
    expect(await verify({ ...ctx, confirmationToken: first })).toBe(true);
    const second = await mint(ctx);
    expect(second).not.toBe(first);
    expect(await verify({ ...ctx, confirmationToken: first })).toBe(false);
    expect(await verify({ ...ctx, confirmationToken: second })).toBe(true);
  });

  it('keeps the token out of the audit descriptor', async () => {
    const evidence = new SignedTokenEvidence();
    await evidence.establish(makeCtx());
    expect(evidence.describeEvidence().detail).not.toContain(evidence.getEstablishedNonce()!);
  });
});

describe('SignedTokenEvidence signing key', () => {
  const PEM = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n';
  const sharedKey = { jwePrivateKey: PEM, jwePrivateKeyPath: '' };
  let backend: InMemorySessionStore<true>;

  beforeEach(() => {
    backend = new InMemorySessionStore<true>({ ttlMs: 5 * 60 * 1000 });
  });

  // A fresh module graph stands in for a separate replica process.
  async function replica(
    oauth: Record<string, string>,
    file?: string,
    provider: 'custom' | 'memory' = 'custom',
  ): Promise<typeof import('./signedTokenEvidence.js')> {
    vi.resetModules();
    vi.doMock('../../../config.js', () => ({
      getConfig: () => ({
        oauth,
        sessionStore: { provider, providerConfig: { module: 'test-shared-store' } },
      }),
    }));
    // Each replica has independent module state and the real namespace wrapper, but loads the
    // same backing store. Its consume is atomic; the provider contract requires this in production.
    vi.doMock('../../../utils/loadProviderModule.js', () => ({
      loadProviderModule: () => ({
        default: class {
          constructor() {
            return backend;
          }
        },
      }),
    }));
    vi.doMock('node:fs', () => ({
      readFileSync: () => {
        if (file === undefined) throw new Error('ENOENT');
        return file;
      },
    }));
    return import('./signedTokenEvidence.js');
  }

  afterEach(() => {
    vi.doUnmock('../../../config.js');
    vi.doUnmock('node:fs');
    vi.doUnmock('../../../utils/loadProviderModule.js');
    vi.resetModules();
    vi.useRealTimers();
  });

  async function crossVerifies(
    a: Awaited<ReturnType<typeof replica>>,
    b: Awaited<ReturnType<typeof replica>>,
  ): Promise<boolean> {
    const ctx = makeCtx();
    const minter = new a.SignedTokenEvidence();
    await minter.establish(ctx);
    return new b.SignedTokenEvidence().verify({
      ...ctx,
      confirmationToken: minter.getEstablishedNonce(),
    });
  }

  it('treats an inline key with escaped newlines the same as one with real newlines', async () => {
    const escaped = { jwePrivateKey: PEM.replace(/\n/g, '\\n'), jwePrivateKeyPath: '' };
    const literal = { jwePrivateKey: PEM, jwePrivateKeyPath: '' };
    expect(await crossVerifies(await replica(escaped), await replica(literal))).toBe(true);
  });

  it('interoperates across replicas using a path-only key', async () => {
    const pathOnly = { jwePrivateKey: '', jwePrivateKeyPath: '/keys/jwe.pem' };
    expect(await crossVerifies(await replica(pathOnly, PEM), await replica(pathOnly, PEM))).toBe(
      true,
    );
  });

  it('consumes a token atomically across replicas, including concurrent confirmations', async () => {
    const a = await replica(sharedKey);
    const b = await replica(sharedKey);
    const ctx = makeCtx();
    const minter = new a.SignedTokenEvidence();
    await minter.establish(ctx);
    const confirm = { ...ctx, confirmationToken: minter.getEstablishedNonce() };
    const results = await Promise.all([
      new b.SignedTokenEvidence().verify(confirm),
      new a.SignedTokenEvidence().verify(confirm),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await new b.SignedTokenEvidence().verify(confirm)).toBe(false);
    const restarted = await replica(sharedKey);
    expect(await new restarted.SignedTokenEvidence().verify(confirm)).toBe(false);
  });

  it('rejects cross-replica confirms with memory storage even when the signing key is shared', async () => {
    const a = await replica(sharedKey, undefined, 'memory');
    const b = await replica(sharedKey, undefined, 'memory');
    expect(await crossVerifies(a, b)).toBe(false);
  });

  it('does not consume valid proof when a mismatched context is submitted', async () => {
    const a = await replica(sharedKey);
    const b = await replica(sharedKey);
    const ctx = makeCtx();
    const minter = new a.SignedTokenEvidence();
    await minter.establish(ctx);
    const confirm = { ...ctx, confirmationToken: minter.getEstablishedNonce() };
    expect(await new b.SignedTokenEvidence().verify({ ...confirm, userLuid: 'other' })).toBe(false);
    expect(await new b.SignedTokenEvidence().verify(confirm)).toBe(true);
  });

  it('fails closed when the store loses an entry', async () => {
    const mod = await replica(sharedKey);
    const ctx = makeCtx();
    const evidence = new mod.SignedTokenEvidence();
    await evidence.establish(ctx);
    const consume = vi.spyOn(backend, 'consume').mockResolvedValue(undefined);
    expect(
      await evidence.verify({ ...ctx, confirmationToken: evidence.getEstablishedNonce() }),
    ).toBe(false);
    expect(consume).toHaveBeenCalledWith(expect.stringMatching(/^flow-mutation-confirmations-v1:/));
  });

  it('does not return a token when the store cannot register its proof', async () => {
    const mod = await replica(sharedKey);
    vi.spyOn(backend, 'set').mockRejectedValue(new Error('store unavailable'));
    const evidence = new mod.SignedTokenEvidence();
    await expect(evidence.establish(makeCtx())).rejects.toThrow('store unavailable');
    expect(evidence.getEstablishedNonce()).toBeUndefined();
  });

  it('fails closed when atomic consumption fails', async () => {
    const mod = await replica(sharedKey);
    const ctx = makeCtx();
    const evidence = new mod.SignedTokenEvidence();
    await evidence.establish(ctx);
    vi.spyOn(backend, 'consume').mockRejectedValue(new Error('store unavailable'));
    await expect(
      evidence.verify({ ...ctx, confirmationToken: evidence.getEstablishedNonce() }),
    ).rejects.toThrow('store unavailable');
  });

  it('rejects a token that expires while consumption is pending', async () => {
    vi.useFakeTimers();
    const mod = await replica(sharedKey);
    const ctx = makeCtx();
    const evidence = new mod.SignedTokenEvidence();
    await evidence.establish(ctx);
    vi.spyOn(backend, 'consume').mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 6 * 60 * 1000);
      return true;
    });
    expect(
      await evidence.verify({ ...ctx, confirmationToken: evidence.getEstablishedNonce() }),
    ).toBe(false);
  });

  it('does not interoperate without a shared key', async () => {
    const none = { jwePrivateKey: '', jwePrivateKeyPath: '' };
    expect(await crossVerifies(await replica(none), await replica(none))).toBe(false);
  });

  it('fails rather than using a random key when the configured key file is unreadable', async () => {
    const mod = await replica({ jwePrivateKey: '', jwePrivateKeyPath: '/missing.pem' });
    await expect(new mod.SignedTokenEvidence().establish(makeCtx())).rejects.toThrow('ENOENT');
  });
});
