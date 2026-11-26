import type { Config } from '../../../config.js';
import { ConfirmationIdentityMissingError } from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { ExpiringMap } from '../../../utils/expiringMap.js';
import { deriveConfirmationTokenKey } from './confirmationTokenCodec.js';
import { EvidenceContext } from './evidence.js';
import {
  exportedForTesting,
  initializeConfirmationTokenKeys,
  resolveConfirmationTokenKeys,
  SignedTokenEvidence,
  SignedTokenEvidenceOptions,
} from './signedTokenEvidence.js';

vi.mock('../../../logging/logger.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../logging/logger.js')>()),
  log: vi.fn(),
}));

const SECRET = 'replica-shared-secret-0123456789abcdef';
const OTHER_SECRET = 'a-completely-different-secret-0123456789';
const TOKEN_PATTERN = /^v1\.[0-9]+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{43}$/;
const T0 = 1_800_000_000_000;

function ctx(overrides: Partial<EvidenceContext> = {}): EvidenceContext {
  return {
    restApi: {} as RestApi,
    siteId: 'site-1',
    target: { id: 'user-1', kind: 'user', state: 'Creator' },
    tool: 'update-user',
    userLuid: 'admin-1',
    binding: 'user-1:Viewer',
    ...overrides,
  };
}

/** One "replica": its own keys (from a secret) and its own replay cache. */
function replica(secret: string, extra: Partial<SignedTokenEvidenceOptions> = {}) {
  const replayCache = new ExpiringMap<string, true>({ defaultExpirationTimeMs: 60_000 });
  return (): SignedTokenEvidence =>
    new SignedTokenEvidence({
      keys: { current: deriveConfirmationTokenKey(secret) },
      replayCache,
      ttlMs: 60_000,
      ...extra,
    });
}

async function preview(evidence: SignedTokenEvidence, context = ctx()): Promise<string> {
  await evidence.establish(context);
  const token = evidence.getEstablishedNonce();
  expect(token).toMatch(TOKEN_PATTERN);
  return token!;
}

function makeConfig(partial: Partial<Config>): Config {
  return {
    disableSessionManagement: false,
    mutationTokenSecret: '',
    mutationTokenSecretPrevious: '',
    ...partial,
  } as Config;
}

describe('SignedTokenEvidence', () => {
  beforeEach(() => {
    exportedForTesting.reset();
    vi.mocked(log).mockClear();
    vi.stubEnv('MUTATION_TOKEN_SECRET', '');
    vi.stubEnv('MUTATION_TOKEN_SECRET_PREVIOUS', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    exportedForTesting.reset();
  });

  it('preview mints a v1 token and confirm accepts it', async () => {
    const make = replica(SECRET);
    const token = await preview(make());
    expect(await make().verify(ctx({ confirmationToken: token }))).toBe(true);
  });

  it('a decimal MUTATION_PREVIEW_TTL_MINUTES (1.17) still mints a token that verifies', async () => {
    vi.stubEnv('MUTATION_PREVIEW_TTL_MINUTES', '1.17');
    const keys = { current: deriveConfirmationTokenKey(SECRET) };
    const replayCache = new ExpiringMap<string, true>({ defaultExpirationTimeMs: 60_000 });
    // No ttlMs override: the TTL comes from getMutationPreviewTtlMs().
    const make = (): SignedTokenEvidence => new SignedTokenEvidence({ keys, replayCache });
    const token = await preview(make());
    expect(await make().verify(ctx({ confirmationToken: token }))).toBe(true);
  });

  it('cross-replica: a token minted on one instance verifies on another with the same secret', async () => {
    const replicaA = replica(SECRET);
    const replicaB = replica(SECRET);
    const token = await preview(replicaA());
    expect(await replicaB().verify(ctx({ confirmationToken: token }))).toBe(true);
  });

  it('rejects a token from a replica with a different secret', async () => {
    const token = await preview(replica(SECRET)());
    const verifier = replica(OTHER_SECRET)();
    expect(await verifier.verify(ctx({ confirmationToken: token }))).toBe(false);
    expect(verifier.explainRejection()).toBeUndefined();
  });

  it('rejects a missing, legacy-UUID or malformed token', async () => {
    const make = replica(SECRET);
    const evidence = make();
    expect(await evidence.verify(ctx())).toBe(false);
    expect(
      await evidence.verify(ctx({ confirmationToken: '123e4567-e89b-42d3-a456-426614174000' })),
    ).toBe(false);
    expect(await evidence.verify(ctx({ confirmationToken: 'v1.1.2.3.4' }))).toBe(false);
    expect(evidence.explainRejection()).toBeUndefined();
  });

  it.each([
    ['siteId', { siteId: 'site-2' }],
    ['userLuid', { userLuid: 'admin-2' }],
    ['tool', { tool: 'cancel-flow-run' as const }],
    ['target id', { target: { id: 'user-2', kind: 'user' as const, state: 'Creator' } }],
    ['binding', { binding: 'user-1:Explorer' }],
  ])('rejects when the %s differs from the preview', async (_label, overrides) => {
    const make = replica(SECRET);
    const token = await preview(make());
    const evidence = make();
    expect(await evidence.verify(ctx({ ...overrides, confirmationToken: token }))).toBe(false);
    expect(evidence.explainRejection()).toBeUndefined();
  });

  it('rejects with an explanation when the target state changed', async () => {
    const make = replica(SECRET);
    const token = await preview(make());
    const evidence = make();
    const changed = ctx({
      confirmationToken: token,
      target: { id: 'user-1', kind: 'user', state: 'Explorer' },
    });
    expect(await evidence.verify(changed)).toBe(false);
    expect(evidence.explainRejection()).toBe(exportedForTesting.STATE_CHANGED_EXPLANATION);
    // A subsequent successful verify clears the explanation.
    const token2 = await preview(make());
    expect(await evidence.verify(ctx({ confirmationToken: token2 }))).toBe(true);
    expect(evidence.explainRejection()).toBeUndefined();
  });

  it('treats an absent target state as empty state on both phases', async () => {
    const make = replica(SECRET);
    const stateless = ctx({ target: { id: 'task-1', kind: 'extract-refresh-task' } });
    const token = await preview(make(), stateless);
    expect(await make().verify({ ...stateless, confirmationToken: token })).toBe(true);
  });

  it('rejects an expired token (expiry between mint and verify)', async () => {
    let now = T0;
    const make = replica(SECRET, { now: () => now, ttlMs: 1_000 });
    const token = await preview(make());
    now = T0 + 1_000;
    const evidence = make();
    expect(await evidence.verify(ctx({ confirmationToken: token }))).toBe(false);
    expect(evidence.explainRejection()).toBeUndefined();
  });

  describe('precheck / preVerify (checks that need no live pre-state)', () => {
    it('precheck accepts only a well-formed token and consumes nothing', async () => {
      const make = replica(SECRET);
      const token = await preview(make());
      const evidence = make();
      expect(evidence.precheck(token)).toBe(true);
      expect(evidence.precheck(undefined)).toBe(false);
      expect(evidence.precheck('garbage')).toBe(false);
      expect(await make().verify(ctx({ confirmationToken: token }))).toBe(true);
    });

    it('preVerify accepts an authentic token whatever the live state, and consumes nothing', async () => {
      const make = replica(SECRET);
      const token = await preview(make());
      const { target: _t, ...rest } = ctx({ confirmationToken: token });
      expect(make().preVerify({ ...rest, target: { id: 'user-1' } })).toBe(true);
      expect(make().preVerify({ ...rest, target: { id: 'user-1' } })).toBe(true);
      expect(await make().verify(ctx({ confirmationToken: token }))).toBe(true);
    });

    it('preVerify rejects bad-mac, wrong target, expired and replayed tokens', async () => {
      let now = T0;
      const make = replica(SECRET, { now: () => now });
      const token = await preview(make());
      const base = { ...ctx({ confirmationToken: token }), target: { id: 'user-1' } };
      expect(replica(OTHER_SECRET)().preVerify(base)).toBe(false);
      expect(make().preVerify({ ...base, target: { id: 'user-2' } })).toBe(false);
      expect(await make().verify(ctx({ confirmationToken: token }))).toBe(true);
      expect(make().preVerify(base)).toBe(false); // replayed
      const fresh = await preview(make());
      now = T0 + 60_000;
      const expired = make();
      expect(expired.preVerify({ ...base, confirmationToken: fresh })).toBe(false);
      expect(expired.explainRejection()).toBeUndefined();
    });
  });

  describe('replay', () => {
    it('rejects a replay on the same replica', async () => {
      const make = replica(SECRET);
      const token = await preview(make());
      expect(await make().verify(ctx({ confirmationToken: token }))).toBe(true);
      const second = make();
      expect(await second.verify(ctx({ confirmationToken: token }))).toBe(false);
      expect(second.explainRejection()).toBeUndefined();
    });

    it('rejects concurrent confirms of one token on the same replica (only one passes)', async () => {
      const make = replica(SECRET);
      const token = await preview(make());
      const results = await Promise.all(
        Array.from({ length: 5 }, () => make().verify(ctx({ confirmationToken: token }))),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it('accepts a cross-replica replay when the state is unchanged', async () => {
      const replicaA = replica(SECRET);
      const replicaB = replica(SECRET);
      const token = await preview(replicaA());
      expect(await replicaA().verify(ctx({ confirmationToken: token }))).toBe(true);
      // Documented caveat: B has its own replay cache, so the replay is accepted while the
      // target is still in the previewed state.
      expect(await replicaB().verify(ctx({ confirmationToken: token }))).toBe(true);
    });

    it('rejects a cross-replica replay once the first confirm changed the state', async () => {
      const replicaA = replica(SECRET);
      const replicaB = replica(SECRET);
      const token = await preview(replicaA());
      expect(await replicaA().verify(ctx({ confirmationToken: token }))).toBe(true);
      // The first confirm applied the role change: the live state is now the new role.
      const afterApply = ctx({
        confirmationToken: token,
        target: { id: 'user-1', kind: 'user', state: 'Viewer' },
      });
      const evidence = replicaB();
      expect(await evidence.verify(afterApply)).toBe(false);
      expect(evidence.explainRejection()).toBe(exportedForTesting.STATE_CHANGED_EXPLANATION);
    });

    it('does not burn a token on a failed verify (wrong state, then correct state)', async () => {
      const make = replica(SECRET);
      const token = await preview(make());
      expect(
        await make().verify(
          ctx({ confirmationToken: token, target: { id: 'user-1', kind: 'user', state: 'x' } }),
        ),
      ).toBe(false);
      expect(await make().verify(ctx({ confirmationToken: token }))).toBe(true);
    });

    it('default instances share the process-wide replay cache', async () => {
      vi.stubEnv('MUTATION_TOKEN_SECRET', SECRET);
      const token = await preview(new SignedTokenEvidence(), ctx());
      expect(await new SignedTokenEvidence().verify(ctx({ confirmationToken: token }))).toBe(true);
      expect(await new SignedTokenEvidence().verify(ctx({ confirmationToken: token }))).toBe(false);
    });
  });

  describe('purpose separation (confirmation vs app-approval)', () => {
    const PURPOSES = ['confirmation', 'app-approval'] as const;

    it.each([
      ['configured secret', SECRET],
      ['per-process random key (no secret)', ''],
    ])('with a %s, a token never verifies under the other purpose', async (_label, secret) => {
      vi.stubEnv('MUTATION_TOKEN_SECRET', secret);
      exportedForTesting.reset();
      for (const mintPurpose of PURPOSES) {
        const verifyPurpose = PURPOSES.find((p) => p !== mintPurpose)!;
        const token = await preview(new SignedTokenEvidence({ purpose: mintPurpose }));
        const wrong = new SignedTokenEvidence({ purpose: verifyPurpose });
        expect(await wrong.verify(ctx({ confirmationToken: token }))).toBe(false);
        // Same purpose still verifies: the failure above is purely the purpose key.
        const right = new SignedTokenEvidence({ purpose: mintPurpose });
        expect(await right.verify(ctx({ confirmationToken: token }))).toBe(true);
      }
    });

    it('rejects a confirmation token presented as an app-approval token for the same namespace', async () => {
      vi.stubEnv('MUTATION_TOKEN_SECRET', SECRET);
      exportedForTesting.reset();
      const confirmationToken = await preview(
        new SignedTokenEvidence({ purpose: 'confirmation' }),
        ctx({ tool: 'delete-content' }),
      );
      const approval = new SignedTokenEvidence({
        purpose: 'app-approval',
        namespace: 'delete-content',
      });
      expect(
        await approval.verify(ctx({ tool: 'confirm-delete-content', confirmationToken })),
      ).toBe(false);

      const approvalToken = await preview(
        new SignedTokenEvidence({ purpose: 'app-approval', namespace: 'delete-content' }),
        ctx({ tool: 'delete-content' }),
      );
      expect(
        await new SignedTokenEvidence({ purpose: 'confirmation' }).verify(
          ctx({ tool: 'delete-content', confirmationToken: approvalToken }),
        ),
      ).toBe(false);
    });
  });

  describe('identity', () => {
    it.each([
      ['siteId', { siteId: '' }],
      ['userLuid', { userLuid: '' }],
    ])('refuses to mint with an empty %s', async (_label, overrides) => {
      const evidence = replica(SECRET)();
      await expect(evidence.establish(ctx(overrides))).rejects.toBeInstanceOf(
        ConfirmationIdentityMissingError,
      );
      await expect(evidence.establish(ctx(overrides))).rejects.toThrow(
        /authenticated site and user identity/,
      );
      expect(evidence.getEstablishedNonce()).toBeUndefined();
    });

    it.each([
      ['siteId', { siteId: '' }],
      ['userLuid', { userLuid: '' }],
    ])('rejects a confirm with an empty %s', async (_label, overrides) => {
      const make = replica(SECRET);
      const token = await preview(make());
      expect(await make().verify(ctx({ ...overrides, confirmationToken: token }))).toBe(false);
    });
  });

  describe('audit descriptor', () => {
    it('reports kind signed-token with a fixed detail that never contains the token', async () => {
      const evidence = replica(SECRET)();
      const before = evidence.describeEvidence();
      const token = await preview(evidence);
      const after = evidence.describeEvidence();
      expect(after).toEqual(before);
      expect(after.kind).toBe('signed-token');
      expect(after.detail).toMatch(/signed short-lived confirmation token/);
      expect(JSON.stringify(after)).not.toContain(token);
      expect(JSON.stringify(after)).not.toContain(token.split('.')[2]);
    });
  });

  describe('key configuration', () => {
    it('with no secret, uses one random key per process (shared by default instances only)', async () => {
      const token = await preview(new SignedTokenEvidence(), ctx());
      // Same process (default instances): verifies.
      expect(await new SignedTokenEvidence().verify(ctx({ confirmationToken: token }))).toBe(true);

      // A "different process" (fresh random key) cannot verify it.
      const token2 = await preview(new SignedTokenEvidence(), ctx());
      exportedForTesting.reset();
      expect(await new SignedTokenEvidence().verify(ctx({ confirmationToken: token2 }))).toBe(
        false,
      );
      // Nor can a replica that has a configured secret.
      expect(await replica(SECRET)().verify(ctx({ confirmationToken: token2 }))).toBe(false);
    });

    it('with a configured secret, default instances verify across a process reset', async () => {
      vi.stubEnv('MUTATION_TOKEN_SECRET', SECRET);
      const token = await preview(new SignedTokenEvidence(), ctx());
      exportedForTesting.reset(); // a new process with the same env
      expect(await new SignedTokenEvidence().verify(ctx({ confirmationToken: token }))).toBe(true);
    });

    it('throws on a secret shorter than 32 characters', () => {
      expect(() =>
        resolveConfirmationTokenKeys({ secret: 'x'.repeat(31), previousSecret: '' }),
      ).toThrow('MUTATION_TOKEN_SECRET must be at least 32 characters long');
      expect(() =>
        resolveConfirmationTokenKeys({ secret: SECRET, previousSecret: 'short' }),
      ).toThrow('MUTATION_TOKEN_SECRET_PREVIOUS must be at least 32 characters long');
    });

    it('never puts the secret in the error message', () => {
      const shortSecret = 'super-secret-but-short';
      try {
        resolveConfirmationTokenKeys({ secret: shortSecret, previousSecret: '' });
        expect.fail('expected a throw');
      } catch (error) {
        expect(String(error)).not.toContain(shortSecret);
      }
    });

    // Trimming happens once, in Config (config.test.ts); the secret source is getConfig() only.
    it('reads the secret from config: a padded env secret derives the same key as the plain one', async () => {
      vi.stubEnv('MUTATION_TOKEN_SECRET', `  ${SECRET}\n`);
      exportedForTesting.reset();
      const token = await preview(new SignedTokenEvidence(), ctx());
      expect(await replica(SECRET)().verify(ctx({ confirmationToken: token }))).toBe(true);
    });

    it('a whitespace-only env secret counts as unset (per-process random key)', async () => {
      vi.stubEnv('MUTATION_TOKEN_SECRET', ' \n\t ');
      exportedForTesting.reset();
      const token = await preview(new SignedTokenEvidence(), ctx());
      expect(await new SignedTokenEvidence().verify(ctx({ confirmationToken: token }))).toBe(true);
      exportedForTesting.reset(); // a "new process": fresh random key
      expect(await new SignedTokenEvidence().verify(ctx({ confirmationToken: token }))).toBe(false);
    });

    it('applies the length rule after trimming', async () => {
      vi.stubEnv('MUTATION_TOKEN_SECRET', ` ${'x'.repeat(31)} `);
      exportedForTesting.reset();
      await expect(new SignedTokenEvidence().establish(ctx())).rejects.toThrow(
        'MUTATION_TOKEN_SECRET must be at least 32 characters long',
      );
    });

    it('throws when only the previous secret is set', () => {
      expect(() => resolveConfirmationTokenKeys({ secret: '', previousSecret: SECRET })).toThrow(
        /MUTATION_TOKEN_SECRET_PREVIOUS is set but MUTATION_TOKEN_SECRET is not/,
      );
    });

    it('accepts exactly 32 characters', () => {
      expect(() =>
        resolveConfirmationTokenKeys({ secret: 'x'.repeat(32), previousSecret: '' }),
      ).not.toThrow();
    });

    it('verifies tokens from the previous secret during rotation; new tokens use the current one', async () => {
      vi.stubEnv('MUTATION_TOKEN_SECRET', OTHER_SECRET);
      const oldToken = await preview(new SignedTokenEvidence(), ctx());

      exportedForTesting.reset();
      vi.stubEnv('MUTATION_TOKEN_SECRET', SECRET);
      vi.stubEnv('MUTATION_TOKEN_SECRET_PREVIOUS', OTHER_SECRET);
      expect(await new SignedTokenEvidence().verify(ctx({ confirmationToken: oldToken }))).toBe(
        true,
      );
      const newToken = await preview(new SignedTokenEvidence(), ctx());
      expect(await replica(SECRET)().verify(ctx({ confirmationToken: newToken }))).toBe(true);
      expect(await replica(OTHER_SECRET)().verify(ctx({ confirmationToken: newToken }))).toBe(
        false,
      );
    });

    it('a short secret in the environment makes the first mint throw', async () => {
      vi.stubEnv('MUTATION_TOKEN_SECRET', 'too-short');
      await expect(new SignedTokenEvidence().establish(ctx())).rejects.toThrow(/at least 32/);
    });
  });

  describe('initializeConfirmationTokenKeys (startup)', () => {
    it('throws at startup on a short secret', () => {
      expect(() =>
        initializeConfirmationTokenKeys(makeConfig({ mutationTokenSecret: 'short' })),
      ).toThrow(/MUTATION_TOKEN_SECRET must be at least 32 characters long/);
    });

    it('warns once when session management is disabled and no secret is set', () => {
      initializeConfirmationTokenKeys(
        makeConfig({ disableSessionManagement: true, mutationTokenSecret: '' }),
      );
      expect(log).toHaveBeenCalledTimes(1);
      expect(vi.mocked(log).mock.calls[0][0]).toMatchObject({
        level: 'warning',
        logger: 'startup',
      });
      expect(vi.mocked(log).mock.calls[0][0].message).toMatch(/MUTATION_TOKEN_SECRET is not set/);
    });

    it('does not warn when a secret is set, nor when sessions are enabled', () => {
      initializeConfirmationTokenKeys(
        makeConfig({ disableSessionManagement: true, mutationTokenSecret: SECRET }),
      );
      initializeConfirmationTokenKeys(makeConfig({ mutationTokenSecret: '' }));
      expect(log).not.toHaveBeenCalled();
    });

    it('never logs the secret', () => {
      initializeConfirmationTokenKeys(
        makeConfig({ disableSessionManagement: true, mutationTokenSecret: SECRET }),
      );
      const logged = JSON.stringify(vi.mocked(log).mock.calls);
      expect(logged).not.toContain(SECRET);
    });

    it('installs the configured keys for default instances', async () => {
      initializeConfirmationTokenKeys(makeConfig({ mutationTokenSecret: SECRET }));
      const token = await preview(new SignedTokenEvidence(), ctx());
      expect(await replica(SECRET)().verify(ctx({ confirmationToken: token }))).toBe(true);
    });
  });
});
