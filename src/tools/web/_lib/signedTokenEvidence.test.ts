import { afterEach, beforeEach } from 'vitest';

import { RestApi } from '../../../sdks/tableau/restApi.js';
import { EvidenceContext } from './evidence.js';
import { SignedTokenEvidence } from './signedTokenEvidence.js';

function makeCtx(overrides: Partial<EvidenceContext> = {}): EvidenceContext {
  return {
    restApi: { siteId: 'site-1' } as unknown as RestApi,
    siteId: 'site-1',
    target: { id: 'flow-1' },
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

describe('SignedTokenEvidence', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('verifies a token minted by a DIFFERENT instance (simulates another replica)', async () => {
    const token = await mint(makeCtx());
    expect(await new SignedTokenEvidence().verify(makeCtx({ confirmationToken: token }))).toBe(
      true,
    );
  });

  it('is single-use on the same process', async () => {
    const token = await mint(makeCtx());
    const confirm = makeCtx({ confirmationToken: token });
    expect(await new SignedTokenEvidence().verify(confirm)).toBe(true);
    expect(await new SignedTokenEvidence().verify(confirm)).toBe(false);
  });

  it.each([
    ['site', { siteId: 'site-2' }],
    ['user', { userLuid: 'user-2' }],
    ['tool', { tool: 'cancel-flow-run' as const }],
    ['target', { target: { id: 'flow-2' } }],
    ['binding', { binding: 'other' }],
  ])('rejects a token replayed against a different %s', async (_name, override) => {
    const token = await mint(makeCtx({ binding: 'b' }));
    const ctx = makeCtx({ binding: 'b', ...override, confirmationToken: token });
    expect(await new SignedTokenEvidence().verify(ctx)).toBe(false);
  });

  it('rejects missing, malformed, and tampered tokens', async () => {
    const token = await mint(makeCtx());
    const [expiry, sig] = token.split('-');
    for (const bad of [
      undefined,
      '',
      'garbage',
      `${expiry}-`,
      `${expiry}-${'0'.repeat(64)}`,
      `${Number(expiry) + 1}-${sig}`,
      `${token}-x`,
    ]) {
      expect(await new SignedTokenEvidence().verify(makeCtx({ confirmationToken: bad }))).toBe(
        false,
      );
    }
  });

  it('rejects an expired token', async () => {
    vi.useFakeTimers();
    const token = await mint(makeCtx());
    vi.advanceTimersByTime(6 * 60 * 1000);
    expect(await new SignedTokenEvidence().verify(makeCtx({ confirmationToken: token }))).toBe(
      false,
    );
  });

  it('never leaks the token in the audit descriptor', async () => {
    const evidence = new SignedTokenEvidence();
    await evidence.establish(makeCtx());
    expect(evidence.describeEvidence().detail).not.toContain(evidence.getEstablishedNonce()!);
  });
});
