import { Err, Ok } from 'ts-results-es';
import type { MockedFunction } from 'vitest';

import {
  ConfirmationIdentityMissingError,
  ConfirmationPreStateForbiddenError,
  ContentNotStaleError,
} from '../../../errors/mcpToolError.js';
import * as logger from '../../../logging/logger.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { ExpiringMap } from '../../../utils/expiringMap.js';
import { getMockRequestHandlerExtra, MOCK_SITE_LUID } from '../toolContext.mock.js';
import { auditRecordSchema } from './auditRecord.js';
import { deriveConfirmationTokenKey } from './confirmationTokenCodec.js';
import { AllEvidence, EvidenceStrategy, NoEvidence, TagEvidence } from './evidence.js';
import { guardMutation, MutationTarget } from './mutationGuard.js';
import { SignedTokenEvidence } from './signedTokenEvidence.js';

const mocks = vi.hoisted(() => ({
  mockAssertAdmin: vi.fn(),
}));

vi.mock('../adminGate.js', () => ({
  assertAdmin: mocks.mockAssertAdmin,
}));

// Auto-mock the logger so we can assert on the audit record emitted to the durable sink without
// writing to stderr. log() becomes a spy.
vi.mock('../../../logging/logger.js');

function makeRestApi(): RestApi {
  // guard only reads restApi.siteId directly; evidence is mocked, so a minimal fake suffices.
  return { siteId: 'test-site-id' } as unknown as RestApi;
}

const target: MutationTarget = {
  id: 'target-1',
  name: 'Sales Extract',
  project: 'Finance',
  owner: 'owner@example.com',
  kind: 'datasource',
};

/** A fully controllable evidence stub so guard behavior can be exercised in isolation. */
function makeEvidence(
  overrides: Partial<EvidenceStrategy<MutationTarget>> = {},
): EvidenceStrategy<MutationTarget> {
  return {
    establish: vi.fn().mockResolvedValue(undefined),
    verify: vi.fn().mockResolvedValue(true),
    describeEvidence: vi.fn().mockReturnValue({ kind: 'tag', detail: "pending-deletion tag 'x'" }),
    ...overrides,
  };
}

/** Pull every audit record that was emitted via log({ logger: 'audit' }). */
function getAuditRecords(): unknown[] {
  const log = logger.log as MockedFunction<typeof logger.log>;
  return log.mock.calls
    .map((call) => call[0])
    .filter((entry) => entry.logger === 'audit')
    .map((entry) => entry.data);
}

describe('guardMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
  });

  async function run(
    opts: Partial<Parameters<typeof guardMutation>[0]> = {},
  ): ReturnType<typeof guardMutation> {
    return guardMutation({
      restApi: makeRestApi(),
      extra: getMockRequestHandlerExtra(),
      tool: 'delete-content',
      action: 'delete',
      mode: 'preview-confirm',
      phase: 'preview',
      evidence: makeEvidence(),
      resolveTarget: async () => target,
      ...opts,
    });
  }

  // --- Admin gate ---

  it('denies and emits a DENIED audit when the actor is not an admin', async () => {
    mocks.mockAssertAdmin.mockResolvedValue(new Err('User is not a site administrator'));
    const result = await run({ phase: 'confirm' });
    expect(result.isErr()).toBe(true);

    const audits = getAuditRecords();
    expect(audits).toHaveLength(1);
    const record = auditRecordSchema.parse(audits[0]);
    expect(record.result).toBe('denied');
    expect(record.denyReason).toBe('not-admin');
    // Even a rejected privilege escalation names the target it tried to act on.
    expect(record.target.id).toBe('target-1');
    expect(record.tool).toBe('delete-content');
  });

  it('resolves the target before emitting the not-admin denial so the record names it', async () => {
    mocks.mockAssertAdmin.mockResolvedValue(new Err('nope'));
    const resolveTarget = vi.fn().mockResolvedValue(target);
    await run({ resolveTarget });
    expect(resolveTarget).toHaveBeenCalled();
  });

  // Fix #3: resolveTarget() does a read that may 403/404/throw. A non-admin attempt is the exact
  // event the audit surface most wants to preserve, so a lookup failure must NOT swallow the DENIED
  // record — the guard falls back to a placeholder target instead of letting the throw propagate.
  it('still emits the DENIED audit (with a placeholder target) when resolveTarget throws on the not-admin path', async () => {
    mocks.mockAssertAdmin.mockResolvedValue(new Err('User is not a site administrator'));
    const resolveTarget = vi.fn().mockRejectedValue(new Error('403 querying target'));
    const result = await run({ phase: 'confirm', resolveTarget });
    expect(result.isErr()).toBe(true);

    const audits = getAuditRecords();
    expect(audits).toHaveLength(1);
    const record = auditRecordSchema.parse(audits[0]);
    expect(record.result).toBe('denied');
    expect(record.denyReason).toBe('not-admin');
    // Placeholder target: id 'unresolved', kind inferred from the tool ('delete-datasource' here).
    expect(record.target.id).toBe('unresolved');
    expect(record.target.kind).toBe('datasource');
  });

  // W-25002517: the signed token's pre-state comes from resolveTarget (e.g. a task's schedule hash).
  // A scope-refused pre-state read is a DENIED attempt returned as a clean typed error, with no
  // evidence established or verified (fail closed).
  it.each(['preview', 'confirm'] as const)(
    'on %s, audits DENIED and returns a ConfirmationPreStateForbiddenError from resolveTarget without touching evidence',
    async (phase) => {
      const preStateError = new ConfirmationPreStateForbiddenError({
        description: "this extract refresh task's current schedule",
        requiredScopes: ['tableau:tasks:read'],
        statusCode: 403,
      });
      const evidence = makeEvidence();
      const result = await run({
        tool: 'update-cloud-extract-refresh-task',
        action: 'update',
        phase,
        evidence,
        confirmationToken: phase === 'confirm' ? 'v1.some-token' : undefined,
        resolveTarget: vi.fn().mockRejectedValue(preStateError),
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBe(preStateError);
        expect(result.error.message).toContain('requires tableau:tasks:read');
      }
      expect(evidence.establish).not.toHaveBeenCalled();
      expect(evidence.verify).not.toHaveBeenCalled();
      const audits = getAuditRecords();
      expect(audits).toHaveLength(1);
      const record = auditRecordSchema.parse(audits[0]);
      expect(record.result).toBe('denied');
      expect(record.denyReason).toBe('confirmation-pre-state-forbidden');
      expect(record.target.id).toBe('unresolved');
      expect(record.target.kind).toBe('extract-refresh-task');
    },
  );

  it.each(['preview', 'confirm'] as const)(
    'on %s, audits DENIED then rethrows an untyped resolveTarget failure (5xx / timeout / network)',
    async (phase) => {
      const evidence = makeEvidence();
      const failure = new Error('network down: secret-param-value');
      await expect(
        run({
          phase,
          tool: 'update-cloud-extract-refresh-task',
          action: 'update',
          resolveTarget: vi.fn().mockRejectedValue(failure),
          evidence,
          confirmationToken: phase === 'confirm' ? 'v1.some-token' : undefined,
          binding: 'binding-fingerprint',
        }),
      ).rejects.toBe(failure);
      expect(evidence.establish).not.toHaveBeenCalled();
      expect(evidence.verify).not.toHaveBeenCalled();
      const audits = getAuditRecords();
      expect(audits).toHaveLength(1);
      const record = auditRecordSchema.parse(audits[0]);
      expect(record.result).toBe('denied');
      expect(record.denyReason).toBe('target-unresolved');
      expect(record.phase).toBe(phase);
      expect(record.target).toEqual({ id: 'unresolved', kind: 'extract-refresh-task' });
      // Fixed reason only: never the error message, the token or a parameter fingerprint.
      const serialized = JSON.stringify(audits[0]);
      expect(serialized).not.toContain('secret-param-value');
      expect(serialized).not.toContain('v1.some-token');
      expect(serialized).not.toContain('binding-fingerprint');
    },
  );

  it('audits a typed (McpToolError) resolveTarget failure with its type, then rethrows', async () => {
    const typed = new ContentNotStaleError('not stale');
    await expect(run({ resolveTarget: vi.fn().mockRejectedValue(typed) })).rejects.toBe(typed);
    const record = auditRecordSchema.parse(getAuditRecords()[0]);
    expect(record.result).toBe('denied');
    expect(record.denyReason).toBe(typed.type);
  });

  // --- confirm: malformed-token short-circuit before resolveTarget ---

  describe('confirm precheck (malformed token rejected before resolveTarget)', () => {
    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['garbage', 'not-a-token'],
      ['legacy UUID', '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f'],
    ])('rejects a %s token with no REST call and a DENIED audit', async (_label, token) => {
      const resolveTarget = vi.fn().mockResolvedValue(target);
      const evidence = new SignedTokenEvidence({
        keys: { current: deriveConfirmationTokenKey('guard-precheck-secret-0123456789abcdef') },
        replayCache: new ExpiringMap<string, true>({ defaultExpirationTimeMs: 60_000 }),
      });
      const verify = vi.spyOn(evidence, 'verify');
      const result = await run({
        phase: 'confirm',
        tool: 'update-user',
        action: 'update',
        evidence,
        resolveTarget,
        confirmationToken: token,
        fallbackTargetKind: 'user',
        targetIdHint: 'user-42',
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('preview-not-run');
        expect(result.error.message).toContain('user user-42');
        expect(result.error.message).toContain('Run update-user with confirm omitted');
      }
      expect(resolveTarget).not.toHaveBeenCalled();
      expect(verify).not.toHaveBeenCalled();
      const audits = getAuditRecords();
      expect(audits).toHaveLength(1);
      const record = auditRecordSchema.parse(audits[0]);
      expect(record.result).toBe('denied');
      expect(record.denyReason).toBe('preview-not-run');
      expect(record.target).toEqual({ id: 'unresolved', kind: 'user' });
    });

    it('does not precheck on preview, nor in confirm-only mode', async () => {
      const precheck = vi.fn().mockReturnValue(false);
      const resolveTarget = vi.fn().mockResolvedValue(target);
      await run({ phase: 'preview', evidence: makeEvidence({ precheck }), resolveTarget });
      await run({
        phase: 'confirm',
        mode: 'confirm-only',
        evidence: makeEvidence({ precheck }),
        resolveTarget,
      });
      expect(precheck).not.toHaveBeenCalled();
      expect(resolveTarget).toHaveBeenCalledTimes(2);
    });

    it('a well-formed token passes the precheck and proceeds to resolveTarget + verify', async () => {
      const precheck = vi.fn().mockReturnValue(true);
      const evidence = makeEvidence({ precheck });
      const resolveTarget = vi.fn().mockResolvedValue(target);
      const result = await run({
        phase: 'confirm',
        evidence,
        resolveTarget,
        confirmationToken: 'v1.x',
      });
      expect(result.isOk()).toBe(true);
      expect(precheck).toHaveBeenCalledWith('v1.x');
      expect(resolveTarget).toHaveBeenCalledOnce();
      expect(evidence.verify).toHaveBeenCalledOnce();
    });

    it('AllEvidence (tag + app approval) rejects a malformed approval token before any REST call', async () => {
      const tagEvidence = new TagEvidence({ cleanupDate: '2026-11-25', kind: 'workbook' });
      const tagVerify = vi.spyOn(tagEvidence, 'verify');
      const resolveTarget = vi.fn().mockResolvedValue({ ...target, kind: 'workbook' });
      const result = await run({
        phase: 'confirm',
        tool: 'confirm-delete-content',
        previewTool: 'delete-content',
        evidence: new AllEvidence([
          tagEvidence,
          new SignedTokenEvidence({ purpose: 'app-approval' }),
        ]),
        resolveTarget,
        confirmationToken: 'garbage',
        fallbackTargetKind: 'workbook',
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Re-run delete-content to preview again');
      }
      expect(resolveTarget).not.toHaveBeenCalled();
      expect(tagVerify).not.toHaveBeenCalled();
    });
  });

  // --- preview-confirm: verify gate ---

  it('on confirm, denies and emits a DENIED audit when evidence.verify is false (forged/precomputed)', async () => {
    const evidence = makeEvidence({ verify: vi.fn().mockResolvedValue(false) });
    const result = await run({ phase: 'confirm', evidence, confirmationToken: 'forged' });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Mutation blocked');
      expect(result.error.message).toContain('cannot be bypassed by computing a token');
    }
    expect(evidence.verify).toHaveBeenCalled();

    const audits = getAuditRecords();
    expect(audits).toHaveLength(1);
    const record = auditRecordSchema.parse(audits[0]);
    expect(record.result).toBe('denied');
    expect(record.denyReason).toBe('preview-not-run');
    expect(record.phase).toBe('confirm');
  });

  it('on a model-visible preview-confirm tool (no previewTool), the denial says to re-run with confirm omitted', async () => {
    const evidence = makeEvidence({ verify: vi.fn().mockResolvedValue(false) });
    const result = await run({ phase: 'confirm', evidence });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Run delete-content with confirm omitted');
      // The app-only recovery (re-preview + approve in panel) must NOT appear for in-place tools.
      expect(result.error.message).not.toContain('confirmation panel');
    }
  });

  it('on an app-only confirm tool (previewTool set), the denial points at the preview tool + panel, not a confirm arg', async () => {
    const evidence = makeEvidence({ verify: vi.fn().mockResolvedValue(false) });
    const result = await run({
      tool: 'delete-content',
      previewTool: 'delete-content',
      phase: 'confirm',
      evidence,
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Re-run delete-content to preview again');
      expect(result.error.message).toContain('approve in the confirmation panel');
      // The model-invisible confirm tool takes no `confirm` arg, so never tell the user to pass one.
      expect(result.error.message).not.toContain('with confirm omitted');
    }
  });

  it('on confirm, allows but emits NO record until recordOutcome fires, then a single terminal record', async () => {
    const evidence = makeEvidence({ verify: vi.fn().mockResolvedValue(true) });
    const result = await run({ phase: 'confirm', evidence });
    expect(result.isOk()).toBe(true);

    // A confirm that passes the gate emits nothing on its own — the terminal outcome record is the
    // sole audit entry for the confirm, so a confirm logs exactly once (not twice).
    expect(getAuditRecords()).toHaveLength(0);

    result.unwrap().recordOutcome({ ok: true });
    const audits = getAuditRecords();
    expect(audits).toHaveLength(1);
    const record = auditRecordSchema.parse(audits[0]);
    expect(record.result).toBe('completed');
    expect(record.phase).toBe('confirm');
    expect(record.denyReason).toBeUndefined();
  });

  it('on preview, a typed establish refusal (missing identity) is a DENIED audit and a clean Err', async () => {
    const evidence = new SignedTokenEvidence({
      keys: { current: deriveConfirmationTokenKey('mutation-guard-identity-secret-0123456789') },
      ttlMs: 60_000,
    });
    const extra = getMockRequestHandlerExtra();
    vi.spyOn(extra, 'getUserLuid').mockReturnValue(undefined as unknown as string);
    const result = await run({ phase: 'preview', evidence, extra });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConfirmationIdentityMissingError);
      expect(result.error.message).toContain('authenticated site and user identity');
    }
    expect(evidence.getEstablishedNonce()).toBeUndefined();
    const audits = getAuditRecords();
    expect(audits).toHaveLength(1);
    const record = auditRecordSchema.parse(audits[0]);
    expect(record.result).toBe('denied');
    expect(record.denyReason).toBe('confirmation-identity-missing');
    expect(record.phase).toBe('preview');
  });

  it('on preview, an untyped establish failure still propagates (no allowed record)', async () => {
    const evidence = makeEvidence({ establish: vi.fn().mockRejectedValue(new Error('boom')) });
    await expect(run({ phase: 'preview', evidence })).rejects.toThrow('boom');
    expect(getAuditRecords()).toHaveLength(0);
  });

  // --- preview-confirm: establish on preview ---

  it('on preview, calls evidence.establish and emits an ALLOWED audit (does NOT verify)', async () => {
    const evidence = makeEvidence();
    const result = await run({ phase: 'preview', evidence });
    expect(result.isOk()).toBe(true);
    expect(evidence.establish).toHaveBeenCalled();
    expect(evidence.verify).not.toHaveBeenCalled();

    const audits = getAuditRecords();
    expect(audits).toHaveLength(1);
    const record = auditRecordSchema.parse(audits[0]);
    expect(record.result).toBe('allowed');
    expect(record.phase).toBe('preview');
  });

  // --- precondition hook (W-24311035) ---

  describe('precondition', () => {
    const notStale = (): ReturnType<
      NonNullable<Parameters<typeof guardMutation>[0]['precondition']>
    > => Promise.resolve(new ContentNotStaleError('Deletion blocked: used recently').toErr());

    it('on preview, a failing precondition denies BEFORE establishing evidence', async () => {
      const evidence = makeEvidence();
      const precondition = vi.fn(notStale);
      const result = await run({ phase: 'preview', evidence, precondition });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('content-not-stale');
        expect(result.error.message).toContain('used recently');
      }
      expect(precondition).toHaveBeenCalledWith(target);
      expect(evidence.establish).not.toHaveBeenCalled();
      const record = auditRecordSchema.parse(getAuditRecords()[0]);
      expect(getAuditRecords()).toHaveLength(1);
      expect(record.result).toBe('denied');
      expect(record.denyReason).toBe('content-not-stale');
      expect(record.phase).toBe('preview');
    });

    it('on confirm, the precondition runs only after evidence verifies', async () => {
      const evidence = makeEvidence({ verify: vi.fn().mockResolvedValue(false) });
      const precondition = vi.fn(notStale);
      const result = await run({ phase: 'confirm', evidence, precondition });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('preview-not-run');
      }
      expect(precondition).not.toHaveBeenCalled();
    });

    it('on confirm, a failing precondition denies with its own reason and no outcome record', async () => {
      const precondition = vi.fn(notStale);
      const result = await run({ phase: 'confirm', precondition });
      expect(result.isErr()).toBe(true);
      const audits = getAuditRecords();
      expect(audits).toHaveLength(1);
      const record = auditRecordSchema.parse(audits[0]);
      expect(record.result).toBe('denied');
      expect(record.denyReason).toBe('content-not-stale');
      expect(record.phase).toBe('confirm');
    });

    it('on confirm, a failing precondition releases what verify consumed; a clean one does not', async () => {
      const release = vi.fn();
      const evidence = makeEvidence({ release });
      await run({ phase: 'confirm', evidence, precondition: vi.fn(notStale) });
      expect(release).toHaveBeenCalledOnce();

      release.mockClear();
      const ok = await run({
        phase: 'confirm',
        evidence,
        precondition: vi.fn().mockResolvedValue(Ok.EMPTY),
      });
      expect(ok.isOk()).toBe(true);
      expect(release).not.toHaveBeenCalled();
    });

    describe('recordOutcome release on a definite non-applied failure', () => {
      it.each([400, 403, 404, 409])(
        'releases the evidence on a %i (the request was rejected, nothing applied)',
        async (httpStatus) => {
          const release = vi.fn();
          const result = await run({ phase: 'confirm', evidence: makeEvidence({ release }) });
          result.unwrap().recordOutcome({ ok: false, failureDetail: 'rejected', httpStatus });
          expect(release).toHaveBeenCalledOnce();
          const record = auditRecordSchema.parse(getAuditRecords()[0]);
          expect(record.result).toBe('failed');
        },
      );

      it.each([
        ['a 500', 500],
        ['a 503', 503],
        ['a 408 timeout', 408],
        ['an unknown status (network error / timeout)', undefined],
      ])('keeps the evidence consumed on %s (outcome unknown)', async (_label, httpStatus) => {
        const release = vi.fn();
        const result = await run({ phase: 'confirm', evidence: makeEvidence({ release }) });
        result.unwrap().recordOutcome({ ok: false, failureDetail: 'failed', httpStatus });
        expect(release).not.toHaveBeenCalled();
      });

      it('never releases on success, on a preview, or in confirm-only mode', async () => {
        const release = vi.fn();
        (await run({ phase: 'confirm', evidence: makeEvidence({ release }) }))
          .unwrap()
          .recordOutcome({ ok: true });
        (await run({ phase: 'preview', evidence: makeEvidence({ release }) }))
          .unwrap()
          .recordOutcome({ ok: false, httpStatus: 404 });
        (await run({ phase: 'confirm', mode: 'confirm-only', evidence: makeEvidence({ release }) }))
          .unwrap()
          .recordOutcome({ ok: false, httpStatus: 404 });
        expect(release).not.toHaveBeenCalled();
      });
    });

    describe('with a real signed token', () => {
      const SECRET = 'mutation-guard-release-secret-0123456789';
      const options = (): ConstructorParameters<typeof SignedTokenEvidence>[0] => ({
        keys: { current: deriveConfirmationTokenKey(SECRET) },
        replayCache,
        ttlMs: 60_000,
      });
      let replayCache: ExpiringMap<string, true>;

      beforeEach(() => {
        replayCache = new ExpiringMap<string, true>({ defaultExpirationTimeMs: 60_000 });
      });

      async function mintToken(): Promise<string> {
        const evidence = new SignedTokenEvidence(options());
        await run({ phase: 'preview', evidence });
        return evidence.getEstablishedNonce()!;
      }

      it('a stale-reject does not burn the token: the same token confirms once the precondition holds', async () => {
        const token = await mintToken();
        const rejected = await run({
          phase: 'confirm',
          evidence: new SignedTokenEvidence(options()),
          confirmationToken: token,
          precondition: vi.fn(notStale),
        });
        expect(rejected.isErr()).toBe(true);
        if (rejected.isErr()) {
          expect(rejected.error.type).toBe('content-not-stale');
        }

        const accepted = await run({
          phase: 'confirm',
          evidence: new SignedTokenEvidence(options()),
          confirmationToken: token,
          precondition: vi.fn().mockResolvedValue(Ok.EMPTY),
        });
        expect(accepted.isOk()).toBe(true);

        // Once a confirm proceeded, the token is consumed: a replay on this replica is rejected.
        const replay = await run({
          phase: 'confirm',
          evidence: new SignedTokenEvidence(options()),
          confirmationToken: token,
        });
        expect(replay.isErr()).toBe(true);
        if (replay.isErr()) {
          expect(replay.error.type).toBe('preview-not-run');
        }
      });

      it('a 4xx failure does not burn the token (retry works); a 5xx does', async () => {
        const token = await mintToken();
        const first = await run({
          phase: 'confirm',
          evidence: new SignedTokenEvidence(options()),
          confirmationToken: token,
        });
        first.unwrap().recordOutcome({ ok: false, httpStatus: 409 });

        const retry = await run({
          phase: 'confirm',
          evidence: new SignedTokenEvidence(options()),
          confirmationToken: token,
        });
        expect(retry.isOk()).toBe(true);
        retry.unwrap().recordOutcome({ ok: false, httpStatus: 502 });

        const afterUnknown = await run({
          phase: 'confirm',
          evidence: new SignedTokenEvidence(options()),
          confirmationToken: token,
        });
        expect(afterUnknown.isErr()).toBe(true);
        if (afterUnknown.isErr()) {
          expect(afterUnknown.error.type).toBe('preview-not-run');
        }
      });

      it('AllEvidence forwards release to the signed member that verified', async () => {
        const tag = new TagEvidence({ cleanupDate: '2026-11-22', kind: 'workbook' });
        vi.spyOn(tag, 'verify').mockResolvedValue(true);
        vi.spyOn(tag, 'establish').mockResolvedValue(undefined);
        const signed = new SignedTokenEvidence(options());
        await run({ phase: 'preview', evidence: new AllEvidence([tag, signed]) });
        const token = signed.getEstablishedNonce()!;

        const confirmEvidence = (): AllEvidence =>
          new AllEvidence([tag, new SignedTokenEvidence(options())]);
        const rejected = await run({
          phase: 'confirm',
          evidence: confirmEvidence(),
          confirmationToken: token,
          precondition: vi.fn(notStale),
        });
        expect(rejected.isErr()).toBe(true);
        const accepted = await run({
          phase: 'confirm',
          evidence: confirmEvidence(),
          confirmationToken: token,
        });
        expect(accepted.isOk()).toBe(true);
      });
    });

    it('a passing precondition lets the mutation proceed', async () => {
      const evidence = makeEvidence();
      const precondition = vi.fn().mockResolvedValue(Ok.EMPTY);
      const result = await run({ phase: 'preview', evidence, precondition });
      expect(result.isOk()).toBe(true);
      expect(evidence.establish).toHaveBeenCalled();
    });
  });

  it('passes the evidence rejection detail into the PreviewNotRun message', async () => {
    const evidence = makeEvidence({
      verify: vi.fn().mockResolvedValue(false),
      explainRejection: () =>
        "It carries 'pending-deletion-2026-08-01' from a different cleanup batch.",
    });
    const result = await run({ phase: 'confirm', evidence });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('different cleanup batch');
    }
  });

  // --- confirm-only mode ---

  it('confirm-only mode never establishes or verifies and emits a single terminal record via recordOutcome', async () => {
    const evidence = new NoEvidence();
    const establishSpy = vi.spyOn(evidence, 'establish');
    const verifySpy = vi.spyOn(evidence, 'verify');
    const result = await guardMutation({
      restApi: makeRestApi(),
      extra: getMockRequestHandlerExtra(),
      tool: 'update-cloud-extract-refresh-task',
      action: 'update',
      mode: 'confirm-only',
      phase: 'confirm',
      evidence,
      resolveTarget: async () => ({ id: 'task-1', kind: 'extract-refresh-task' }),
    });
    expect(result.isOk()).toBe(true);
    expect(establishSpy).not.toHaveBeenCalled();
    expect(verifySpy).not.toHaveBeenCalled();

    // A confirm logs exactly once: nothing until the caller reports the outcome.
    expect(getAuditRecords()).toHaveLength(0);
    result.unwrap().recordOutcome({ ok: true });

    const record = auditRecordSchema.parse(getAuditRecords()[0]);
    expect(record.action).toBe('update');
    expect(record.confirmationEvidence.kind).toBe('none');
    expect(record.result).toBe('completed');
  });

  // --- audit record fidelity ---

  it('emits the audit on the dedicated audit logger and the record always parses against the schema', async () => {
    await run({ phase: 'preview' });
    const log = logger.log as MockedFunction<typeof logger.log>;
    const auditCall = log.mock.calls.find((c) => c[0].logger === 'audit');
    expect(auditCall).toBeTruthy();
    // Required fields land on the record.
    const record = auditRecordSchema.parse(auditCall![0].data);
    expect(record.schemaVersion).toBe(2);
    expect(typeof record.timestamp).toBe('string');
    expect(record.actor.siteLuid).toBe(MOCK_SITE_LUID);
    expect(record.actor.siteName).toBe('tc25');
  });

  it('SECURITY: the raw signed token never appears in the emitted audit record', async () => {
    const evidence = new SignedTokenEvidence();
    // Preview phase establishes a nonce; the audit must describe — never embed — it.
    await guardMutation({
      restApi: makeRestApi(),
      extra: getMockRequestHandlerExtra(),
      tool: 'delete-content',
      action: 'delete',
      mode: 'preview-confirm',
      phase: 'preview',
      evidence,
      resolveTarget: async () => ({ id: 'task-1', kind: 'extract-refresh-task' }),
    });
    const nonce = evidence.getEstablishedNonce()!;
    const serialized = JSON.stringify(getAuditRecords()[0]);
    expect(serialized).not.toContain(nonce);
    const record = auditRecordSchema.parse(getAuditRecords()[0]);
    expect(record.confirmationEvidence.kind).toBe('signed-token');
  });

  // --- Target state pass-through (SignedTokenEvidence) ---

  it('passes target.state to establish on preview', async () => {
    const evidence = makeEvidence();
    await run({
      phase: 'preview',
      evidence,
      resolveTarget: async () => ({ ...target, state: 'Creator' }),
    });
    expect(evidence.establish).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ state: 'Creator' }) }),
    );
  });

  it('passes target.state to verify on confirm', async () => {
    const evidence = makeEvidence();
    await run({
      phase: 'confirm',
      evidence,
      confirmationToken: 'tok',
      resolveTarget: async () => ({ ...target, state: 'schedule-hash' }),
    });
    expect(evidence.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmationToken: 'tok',
        target: expect.objectContaining({ state: 'schedule-hash' }),
      }),
    );
  });

  it('never writes target.state into the audit record', async () => {
    await run({
      phase: 'preview',
      resolveTarget: async () => ({ ...target, state: 'secret-ish-state-value' }),
    });
    expect(JSON.stringify(getAuditRecords())).not.toContain('secret-ish-state-value');
  });
});
