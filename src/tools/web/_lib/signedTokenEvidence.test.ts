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
