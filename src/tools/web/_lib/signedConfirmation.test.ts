import { PreviewNotRunError } from '../../../errors/mcpToolError.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { ExpiringMap } from '../../../utils/expiringMap.js';
import { deriveConfirmationTokenKey } from './confirmationTokenCodec.js';
import { SignedConfirmation, SignedConfirmationSpec } from './signedConfirmation.js';
import { exportedForTesting, SignedTokenEvidenceOptions } from './signedTokenEvidence.js';

const SECRET = 'signed-confirmation-secret-0123456789abc';
const TOKEN_IN_TEXT =
  /confirmationToken: "(v1\.[0-9]+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{43})"/;
const caller = { restApi: { siteId: 'site-1' } as RestApi, userLuid: 'user-1' };

function spec(overrides: Partial<SignedConfirmationSpec> = {}): SignedConfirmationSpec {
  return {
    tool: 'run-flow',
    targetId: 'flow-1',
    targetKind: 'flow',
    binding: 'b1',
    text: {
      subject: 'present this proposed flow run',
      approvalClause: 'confirm it. Do NOT run',
      tail: ' before starting the flow run).',
    },
    ...overrides,
  };
}

/** One "replica": keys from `secret`, its own replay cache. */
function replica(secret = SECRET): SignedTokenEvidenceOptions {
  return {
    keys: { current: deriveConfirmationTokenKey(secret) },
    replayCache: new ExpiringMap<string, true>({ defaultExpirationTimeMs: 60_000 }),
    ttlMs: 60_000,
  };
}

async function preview(confirmation: SignedConfirmation): Promise<string> {
  const text = await confirmation.preview(caller);
  const match = text.match(TOKEN_IN_TEXT);
  expect(match, text).not.toBeNull();
  return match![1];
}

describe('SignedConfirmation', () => {
  it('renders the short-lived (not single-use) NEXT STEP wording with the minted token', async () => {
    const text = await new SignedConfirmation(spec(), replica()).preview(caller);
    expect(text).toContain('present this proposed flow run');
    expect(text).toContain('short-lived token bound to this change');
    expect(text).not.toContain('single-use');
    expect(text).toMatch(TOKEN_IN_TEXT);
  });

  it('verifies on another replica with the same secret, rejects a replay on that replica', async () => {
    const token = await preview(new SignedConfirmation(spec(), replica()));
    const other = replica();
    await expect(new SignedConfirmation(spec(), other).confirm(caller, token)).resolves.toBe(
      undefined,
    );
    await expect(new SignedConfirmation(spec(), other).confirm(caller, token)).rejects.toThrow(
      PreviewNotRunError,
    );
  });

  it('rejects a token from a different secret, a different binding or a different target', async () => {
    const token = await preview(new SignedConfirmation(spec(), replica()));
    for (const [overrides, options] of [
      [{}, replica('another-secret-entirely-0123456789abcdef')],
      [{ binding: 'b2' }, replica()],
      [{ targetId: 'flow-2' }, replica()],
      [{ tool: 'run-flow-task' as const }, replica()],
    ] as const) {
      await expect(
        new SignedConfirmation(spec(overrides), options).confirm(caller, token),
      ).rejects.toThrow('could not verify that a preview ran');
    }
  });

  it('rejects with the state-changed explanation when resolveState differs', async () => {
    const token = await preview(
      new SignedConfirmation(spec({ resolveState: async () => 'S1' }), replica()),
    );
    const confirm = new SignedConfirmation(spec({ resolveState: async () => 'S2' }), replica());
    await expect(confirm.confirm(caller, token)).rejects.toThrow(
      exportedForTesting.STATE_CHANGED_EXPLANATION,
    );
  });

  it('fails closed when resolveState throws: no token on preview, no pass on confirm', async () => {
    const failing = spec({
      resolveState: async () => {
        throw new Error('lookup failed');
      },
    });
    const evidenceOptions = replica();
    const confirmation = new SignedConfirmation(failing, evidenceOptions);
    await expect(confirmation.preview(caller)).rejects.toThrow('lookup failed');
    expect(confirmation.evidence.getEstablishedNonce()).toBeUndefined();

    const token = await preview(
      new SignedConfirmation(spec({ resolveState: async () => 'S1' }), replica()),
    );
    await expect(new SignedConfirmation(failing, replica()).confirm(caller, token)).rejects.toThrow(
      'lookup failed',
    );
  });

  it('rejects a missing token with the generic preview-not-run message', async () => {
    await expect(
      new SignedConfirmation(spec(), replica()).confirm(caller, undefined),
    ).rejects.toThrow('Run run-flow with confirm omitted (or false) first to preview');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['garbage', 'not-a-token'],
    ['wrong version', 'v2.1.a.b.c'],
  ])(
    'rejects a %s token before resolveState (no REST lookup, preview-first message)',
    async (_label, token) => {
      const resolveState = vi.fn(async () => {
        throw new Error('lookup failed');
      });
      const confirm = new SignedConfirmation(spec({ resolveState }), replica()).confirm(
        caller,
        token,
      );
      await expect(confirm).rejects.toThrow(PreviewNotRunError);
      await expect(confirm).rejects.toThrow(
        'Run run-flow with confirm omitted (or false) first to preview',
      );
      expect(resolveState).not.toHaveBeenCalled();
    },
  );

  describe('verifies the token before the pre-state REST reads', () => {
    it('rejects a forged (wrong-secret) token as bad-mac without calling resolveState', async () => {
      const token = await preview(
        new SignedConfirmation(
          spec({ resolveState: async () => 'S1' }),
          replica('another-secret-entirely-0123456789abcdef'),
        ),
      );
      const resolveState = vi.fn(async () => 'S2');
      const confirm = new SignedConfirmation(spec({ resolveState }), replica());
      const rejection = confirm.confirm(caller, token);
      await expect(rejection).rejects.toThrow(PreviewNotRunError);
      // Never the state-changed explanation for an inauthentic token (no state oracle).
      await expect(rejection).rejects.not.toThrow(exportedForTesting.STATE_CHANGED_EXPLANATION);
      expect(resolveState).not.toHaveBeenCalled();
    });

    it('rejects an expired token without calling resolveState', async () => {
      let now = 1_800_000_000_000;
      const options = { ...replica(), now: () => now };
      const token = await preview(
        new SignedConfirmation(spec({ resolveState: async () => 'S1' }), options),
      );
      now += 60_000;
      const resolveState = vi.fn(async () => 'S1');
      await expect(
        new SignedConfirmation(spec({ resolveState }), options).confirm(caller, token),
      ).rejects.toThrow(PreviewNotRunError);
      expect(resolveState).not.toHaveBeenCalled();
    });

    it('rejects a same-replica replay without calling resolveState', async () => {
      const options = replica();
      const token = await preview(
        new SignedConfirmation(spec({ resolveState: async () => 'S1' }), options),
      );
      await new SignedConfirmation(spec({ resolveState: async () => 'S1' }), options).confirm(
        caller,
        token,
      );
      const resolveState = vi.fn(async () => 'S1');
      await expect(
        new SignedConfirmation(spec({ resolveState }), options).confirm(caller, token),
      ).rejects.toThrow(PreviewNotRunError);
      expect(resolveState).not.toHaveBeenCalled();
    });

    it('reports state-changed only for an authentic, unexpired token (after one resolveState)', async () => {
      const options = replica();
      const token = await preview(
        new SignedConfirmation(spec({ resolveState: async () => 'S1' }), options),
      );
      const resolveState = vi.fn(async () => 'S2');
      await expect(
        new SignedConfirmation(spec({ resolveState }), options).confirm(caller, token),
      ).rejects.toThrow(exportedForTesting.STATE_CHANGED_EXPLANATION);
      expect(resolveState).toHaveBeenCalledOnce();
    });
  });

  it('calls resolveState on confirm for a well-formed token', async () => {
    const token = await preview(
      new SignedConfirmation(spec({ resolveState: async () => 'S1' }), replica()),
    );
    const resolveState = vi.fn(async () => 'S1');
    await expect(
      new SignedConfirmation(spec({ resolveState }), replica()).confirm(caller, token),
    ).resolves.toBe(undefined);
    expect(resolveState).toHaveBeenCalledOnce();
  });

  describe('confirmAndRun', () => {
    function httpError(status: number): Error {
      return Object.assign(new Error(`Request failed with status code ${status}`), {
        isAxiosError: true,
        response: { status },
      });
    }

    it('runs the mutation after a verified confirm and keeps the token consumed on success', async () => {
      const options = replica();
      const token = await preview(new SignedConfirmation(spec(), options));
      const run = vi.fn(async () => 'job');
      await expect(
        new SignedConfirmation(spec(), options).confirmAndRun(caller, token, run),
      ).resolves.toBe('job');
      expect(run).toHaveBeenCalledOnce();
      await expect(
        new SignedConfirmation(spec(), options).confirmAndRun(caller, token, run),
      ).rejects.toThrow(PreviewNotRunError);
      expect(run).toHaveBeenCalledOnce();
    });

    it('does not run the mutation when confirm rejects', async () => {
      const run = vi.fn(async () => 'job');
      await expect(
        new SignedConfirmation(spec(), replica()).confirmAndRun(caller, 'not-a-token', run),
      ).rejects.toThrow(PreviewNotRunError);
      expect(run).not.toHaveBeenCalled();
    });

    it.each([400, 403, 404, 409])(
      'releases the token on a definite %i (nothing applied): a retry with the same token passes',
      async (status) => {
        const options = replica();
        const token = await preview(new SignedConfirmation(spec(), options));
        const error = httpError(status);
        await expect(
          new SignedConfirmation(spec(), options).confirmAndRun(caller, token, async () => {
            throw error;
          }),
        ).rejects.toBe(error);
        await expect(
          new SignedConfirmation(spec(), options).confirmAndRun(caller, token, async () => 'job'),
        ).resolves.toBe('job');
      },
    );

    it.each([
      ['a 500', httpError(500)],
      ['a 503', httpError(503)],
      ['a 408', httpError(408)],
      ['a network error (no status)', new Error('ECONNRESET')],
    ])('keeps the token consumed on %s (outcome unknown)', async (_label, error) => {
      const options = replica();
      const token = await preview(new SignedConfirmation(spec(), options));
      await expect(
        new SignedConfirmation(spec(), options).confirmAndRun(caller, token, async () => {
          throw error;
        }),
      ).rejects.toBe(error);
      await expect(
        new SignedConfirmation(spec(), options).confirmAndRun(caller, token, async () => 'job'),
      ).rejects.toThrow(PreviewNotRunError);
    });
  });

  it('exposes an audit descriptor that never contains the token', async () => {
    const confirmation = new SignedConfirmation(spec(), replica());
    const token = await preview(confirmation);
    const descriptor = confirmation.evidence.describeEvidence();
    expect(descriptor.kind).toBe('signed-token');
    expect(JSON.stringify(descriptor)).not.toContain(token);
  });
});
