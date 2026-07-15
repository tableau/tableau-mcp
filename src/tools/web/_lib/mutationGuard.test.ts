import { Err, Ok } from 'ts-results-es';
import type { MockedFunction } from 'vitest';

import * as logger from '../../../logging/logger.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { auditRecordSchema } from './auditRecord.js';
import { EvidenceStrategy, NoEvidence, RegistryEvidence } from './evidence.js';
import { guardMutation, MutationTarget } from './mutationGuard.js';

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

  it('on confirm, allows and emits an ALLOWED audit when evidence.verify is true', async () => {
    const evidence = makeEvidence({ verify: vi.fn().mockResolvedValue(true) });
    const result = await run({ phase: 'confirm', evidence });
    expect(result.isOk()).toBe(true);

    const audits = getAuditRecords();
    expect(audits).toHaveLength(1);
    const record = auditRecordSchema.parse(audits[0]);
    expect(record.result).toBe('allowed');
    expect(record.phase).toBe('confirm');
    expect(record.denyReason).toBeUndefined();
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

  // --- confirm-only mode ---

  it('confirm-only mode never establishes or verifies and still emits an ALLOWED audit', async () => {
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

    const record = auditRecordSchema.parse(getAuditRecords()[0]);
    expect(record.action).toBe('update');
    expect(record.confirmationEvidence.kind).toBe('none');
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
    expect(record.actor.siteLuid).toBe('test-site-luid');
    expect(record.actor.siteName).toBe('tc25');
  });

  it('SECURITY: the raw RegistryEvidence nonce never appears in the emitted audit record', async () => {
    const evidence = new RegistryEvidence();
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
    expect(record.confirmationEvidence.kind).toBe('registry-nonce');
  });
});
