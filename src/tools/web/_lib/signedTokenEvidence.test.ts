import { afterEach } from 'vitest';

import { RestApi } from '../../../sdks/tableau/restApi.js';
import { EvidenceContext } from './evidence.js';
import { SignedTokenEvidence } from './signedTokenEvidence.js';

// Spent signatures are module state, so each test gets its own target.
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

// A fresh instance stands in for another replica.
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

  it('accepts a token once per process', async () => {
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
    const [expiry, signature] = token.split('-');
    const bad = [
      undefined,
      '',
      'garbage',
      `${expiry}-`,
      `${expiry}-${'0'.repeat(64)}`,
      `${Number(expiry) + 1}-${signature}`,
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

  it('keeps the token out of the audit descriptor', async () => {
    const evidence = new SignedTokenEvidence();
    await evidence.establish(makeCtx());
    expect(evidence.describeEvidence().detail).not.toContain(evidence.getEstablishedNonce()!);
  });
});

describe('SignedTokenEvidence signing key', () => {
  const PEM = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n';

  // A fresh module graph stands in for a separate replica process.
  async function replica(
    oauth: Record<string, string>,
    file?: string,
  ): Promise<typeof import('./signedTokenEvidence.js')> {
    vi.resetModules();
    vi.doMock('../../../config.js', () => ({ getConfig: () => ({ oauth }) }));
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
    vi.resetModules();
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

  it('does not interoperate without a shared key', async () => {
    const none = { jwePrivateKey: '', jwePrivateKeyPath: '' };
    expect(await crossVerifies(await replica(none), await replica(none))).toBe(false);
  });

  it('fails rather than using a random key when the configured key file is unreadable', async () => {
    const mod = await replica({ jwePrivateKey: '', jwePrivateKeyPath: '/missing.pem' });
    await expect(new mod.SignedTokenEvidence().establish(makeCtx())).rejects.toThrow('ENOENT');
  });
});
