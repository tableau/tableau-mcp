import { afterEach, beforeEach, Mock } from 'vitest';

import { RestApi } from '../../../sdks/tableau/restApi.js';
import { createAppApprovalEvidence } from './appApproval.js';
import {
  AllEvidence,
  EvidenceContext,
  evidenceExportedForTesting,
  EvidenceStrategy,
  getMutationPreviewTtlMs,
  NoEvidence,
  TagEvidence,
} from './evidence.js';
import { MutationTarget } from './mutationGuard.js';
import { exportedForTesting as signedTokenTesting } from './signedTokenEvidence.js';

// The evidence strategies only ever touch a small slice of RestApi (tag add/query for TagEvidence;
// nothing for NoEvidence), so we hand-build a minimal fake instead of the full SDK.
const mocks = vi.hoisted(() => ({
  mockAddTagsToDatasource: vi.fn(),
  mockQueryDatasource: vi.fn(),
  mockAddTagsToWorkbook: vi.fn(),
  mockGetWorkbook: vi.fn(),
  mockLog: vi.fn(),
}));

vi.mock('../../../logging/logger.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../logging/logger.js')>()),
  log: mocks.mockLog,
}));

function makeRestApi(): RestApi {
  // Minimal RestApi fake exposing only the tag add/query methods TagEvidence touches.
  return {
    siteId: 'test-site-id',
    datasourcesMethods: {
      addTagsToDatasource: mocks.mockAddTagsToDatasource,
      queryDatasource: mocks.mockQueryDatasource,
    },
    workbooksMethods: {
      addTagsToWorkbook: mocks.mockAddTagsToWorkbook,
      getWorkbook: mocks.mockGetWorkbook,
    },
  } as unknown as RestApi;
}

function makeCtx(overrides: Partial<EvidenceContext> = {}): EvidenceContext {
  const target: MutationTarget = { id: 'target-1', kind: 'datasource' };
  return {
    restApi: makeRestApi(),
    siteId: 'test-site-id',
    target,
    tool: 'delete-content',
    userLuid: 'user-1',
    ...overrides,
  };
}

describe('TagEvidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockAddTagsToDatasource.mockResolvedValue(undefined);
    mocks.mockAddTagsToWorkbook.mockResolvedValue(undefined);
  });

  const BATCH = '2026-09-25';
  const BATCH_TAG = 'pending-deletion-2026-09-25';

  it('describes itself as a tag carrying the date-stamped batch label', () => {
    const evidence = new TagEvidence({ cleanupDate: BATCH, kind: 'datasource' });
    const descriptor = evidence.describeEvidence();
    expect(descriptor.kind).toBe('tag');
    expect(descriptor.detail).toContain(BATCH_TAG);
    expect(evidence.getPendingTag()).toBe(BATCH_TAG);
  });

  it('establish tags the datasource with the batch label', async () => {
    const evidence = new TagEvidence({ cleanupDate: BATCH, kind: 'datasource' });
    await evidence.establish(makeCtx());
    expect(mocks.mockAddTagsToDatasource).toHaveBeenCalledWith({
      datasourceId: 'target-1',
      siteId: 'test-site-id',
      tagLabels: [BATCH_TAG],
    });
  });

  it('establish tags the workbook with the batch label', async () => {
    const evidence = new TagEvidence({ cleanupDate: BATCH, kind: 'workbook' });
    const ctx = makeCtx({ target: { id: 'wb-1', kind: 'workbook' }, tool: 'delete-content' });
    await evidence.establish(ctx);
    expect(mocks.mockAddTagsToWorkbook).toHaveBeenCalledWith({
      workbookId: 'wb-1',
      siteId: 'test-site-id',
      tagLabels: [BATCH_TAG],
    });
  });

  // --- verify: exact batch tag PRESENCE → true, anything else → false (live re-fetch) ---

  it('verify returns true when the live datasource carries the batch tag', async () => {
    mocks.mockQueryDatasource.mockResolvedValue({ tags: { tag: [{ label: BATCH_TAG }] } });
    const evidence = new TagEvidence({ cleanupDate: BATCH, kind: 'datasource' });
    await expect(evidence.verify(makeCtx())).resolves.toBe(true);
    expect(evidence.explainRejection()).toBeUndefined();
    // The check is a fresh live re-fetch, not anything cached.
    expect(mocks.mockQueryDatasource).toHaveBeenCalledWith({
      datasourceId: 'target-1',
      siteId: 'test-site-id',
    });
  });

  it('verify returns false with no explanation when no marker is present', async () => {
    mocks.mockQueryDatasource.mockResolvedValue({ tags: {} });
    const evidence = new TagEvidence({ cleanupDate: BATCH, kind: 'datasource' });
    await expect(evidence.verify(makeCtx())).resolves.toBe(false);
    expect(evidence.explainRejection()).toBeUndefined();
  });

  it('verify returns false when an unrelated tag is present', async () => {
    mocks.mockQueryDatasource.mockResolvedValue({ tags: { tag: [{ label: 'some-other-tag' }] } });
    const evidence = new TagEvidence({ cleanupDate: BATCH, kind: 'datasource' });
    await expect(evidence.verify(makeCtx())).resolves.toBe(false);
  });

  it('verify rejects a marker from a DIFFERENT cleanup batch and explains why', async () => {
    mocks.mockQueryDatasource.mockResolvedValue({
      tags: { tag: [{ label: 'pending-deletion-2026-08-01' }] },
    });
    const evidence = new TagEvidence({ cleanupDate: BATCH, kind: 'datasource' });
    await expect(evidence.verify(makeCtx())).resolves.toBe(false);
    const explanation = evidence.explainRejection();
    expect(explanation).toContain('pending-deletion-2026-08-01');
    expect(explanation).toContain('different cleanup batch');
    expect(explanation).toContain(BATCH_TAG);
  });

  it('verify rejects the legacy undated pending-deletion tag', async () => {
    mocks.mockGetWorkbook.mockResolvedValue({ tags: { tag: [{ label: 'pending-deletion' }] } });
    const evidence = new TagEvidence({ cleanupDate: BATCH, kind: 'workbook' });
    await expect(
      evidence.verify(makeCtx({ target: { id: 'wb-1', kind: 'workbook' } })),
    ).resolves.toBe(false);
    expect(evidence.explainRejection()).toContain("'pending-deletion'");
  });

  it('verify returns true for a workbook carrying the batch tag alongside an older marker', async () => {
    mocks.mockGetWorkbook.mockResolvedValue({
      tags: { tag: [{ label: 'pending-deletion-2026-08-01' }, { label: BATCH_TAG }] },
    });
    const evidence = new TagEvidence({ cleanupDate: BATCH, kind: 'workbook' });
    await expect(
      evidence.verify(makeCtx({ target: { id: 'wb-1', kind: 'workbook' } })),
    ).resolves.toBe(true);
  });

  it('verify returns false when the workbook has no tags object at all', async () => {
    mocks.mockGetWorkbook.mockResolvedValue({});
    const evidence = new TagEvidence({ cleanupDate: BATCH, kind: 'workbook' });
    await expect(
      evidence.verify(makeCtx({ target: { id: 'wb-1', kind: 'workbook' } })),
    ).resolves.toBe(false);
  });
});

describe('AllEvidence (AND-composition)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MUTATION_PREVIEW_TTL_MINUTES', undefined);
    mocks.mockGetWorkbook.mockResolvedValue({
      tags: { tag: [{ label: 'pending-deletion-2026-09-25' }] },
    });
  });

  function appCtx(id: string, approvalToken?: string): EvidenceContext {
    return makeCtx({
      target: { id, kind: 'workbook' },
      tool: 'confirm-delete-content',
      confirmationToken: approvalToken,
    });
  }

  /** Mints a signed app-approval token the way the delete-content preview does. */
  async function approve(id: string): Promise<string> {
    const evidence = createAppApprovalEvidence('delete-content');
    await evidence.establish(makeCtx({ target: { id, kind: 'workbook' }, tool: 'delete-content' }));
    return evidence.getEstablishedNonce()!;
  }

  function tagAndApproval(): AllEvidence {
    return new AllEvidence([
      new TagEvidence({ cleanupDate: '2026-09-25', kind: 'workbook' }),
      createAppApprovalEvidence('delete-content'),
    ]);
  }

  beforeEach(() => {
    signedTokenTesting.reset();
  });

  it('verify is true only when EVERY strategy verifies (tag present AND approval token valid)', async () => {
    const token = await approve('wb-and-ok');
    await expect(tagAndApproval().verify(appCtx('wb-and-ok', token))).resolves.toBe(true);
  });

  it('verify is false when the tag is missing even if the approval token is valid', async () => {
    mocks.mockGetWorkbook.mockResolvedValue({ tags: { tag: [{ label: 'other' }] } });
    const token = await approve('wb-and-notag');
    await expect(tagAndApproval().verify(appCtx('wb-and-notag', token))).resolves.toBe(false);
  });

  it('a failed tag check does not consume the approval token (tag is checked first)', async () => {
    const token = await approve('wb-and-retry');
    mocks.mockGetWorkbook.mockResolvedValueOnce({ tags: { tag: [{ label: 'other' }] } });
    await expect(tagAndApproval().verify(appCtx('wb-and-retry', token))).resolves.toBe(false);
    await expect(tagAndApproval().verify(appCtx('wb-and-retry', token))).resolves.toBe(true);
  });

  it('verify is false when no approval token is supplied even if the tag is present', async () => {
    await expect(tagAndApproval().verify(appCtx('wb-and-noapproval'))).resolves.toBe(false);
  });

  it('verify is false for an approval token minted for a different target', async () => {
    const token = await approve('wb-other');
    await expect(tagAndApproval().verify(appCtx('wb-and-swap', token))).resolves.toBe(false);
  });

  it('explainRejection delegates to the strategy that failed (cross-batch tag)', async () => {
    mocks.mockGetWorkbook.mockResolvedValue({
      tags: { tag: [{ label: 'pending-deletion-2026-08-01' }] },
    });
    const token = await approve('wb-and-crossbatch');
    const all = tagAndApproval();
    await expect(all.verify(appCtx('wb-and-crossbatch', token))).resolves.toBe(false);
    expect(all.explainRejection()).toContain('different cleanup batch');
  });

  it('release() un-consumes the approval token after a passing verify (precondition reject)', async () => {
    const token = await approve('wb-and-release');
    const all = tagAndApproval();
    await expect(all.verify(appCtx('wb-and-release', token))).resolves.toBe(true);
    all.release();
    // The guard released it (e.g. the stale precondition rejected): the token verifies again.
    await expect(tagAndApproval().verify(appCtx('wb-and-release', token))).resolves.toBe(true);
    // Without a release, it is consumed: a replay on this replica is rejected.
    await expect(tagAndApproval().verify(appCtx('wb-and-release', token))).resolves.toBe(false);
  });

  it('release() forwards only to the members that verified', async () => {
    type StubMember = EvidenceStrategy<MutationTarget> & {
      verify: Mock;
      release: Mock;
    };
    const member = (verify: boolean | undefined): StubMember => ({
      establish: vi.fn(),
      verify: vi.fn().mockResolvedValue(verify),
      release: vi.fn(),
      describeEvidence: () => ({ kind: 'none' as const }),
    });
    const members = [member(true), member(false), member(undefined)];
    const all = new AllEvidence(members);
    await expect(all.verify(appCtx('wb-and-partial'))).resolves.toBe(false);
    // The later member failed, so the composite undid the first member's consumption.
    expect(members[0].release).toHaveBeenCalledOnce();
    expect(members[1].release).not.toHaveBeenCalled();
    expect(members[2].verify).not.toHaveBeenCalled();
    expect(members[2].release).not.toHaveBeenCalled();
    // A later explicit release is a no-op (nothing left verified).
    all.release();
    expect(members[0].release).toHaveBeenCalledOnce();
  });

  it('describes itself with the signed-token member for the audit record', () => {
    expect(tagAndApproval().describeEvidence().kind).toBe('signed-token');
  });
});

describe('getMutationPreviewTtlMs', () => {
  const MINUTE = 1000 * 60;
  beforeEach(() => {
    evidenceExportedForTesting.resetTtlClampWarning();
    mocks.mockLog.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to 5 minutes', () => {
    vi.stubEnv('MUTATION_PREVIEW_TTL_MINUTES', undefined);
    expect(getMutationPreviewTtlMs()).toBe(5 * MINUTE);
  });

  it('honors an in-range value, including the 5-minute max', () => {
    vi.stubEnv('MUTATION_PREVIEW_TTL_MINUTES', '2');
    expect(getMutationPreviewTtlMs()).toBe(2 * MINUTE);
    vi.stubEnv('MUTATION_PREVIEW_TTL_MINUTES', '1');
    expect(getMutationPreviewTtlMs()).toBe(1 * MINUTE);
    vi.stubEnv('MUTATION_PREVIEW_TTL_MINUTES', '5');
    expect(getMutationPreviewTtlMs()).toBe(5 * MINUTE);
    expect(mocks.mockLog).not.toHaveBeenCalled();
  });

  it('clamps a value above the 5-minute max to 5 minutes and warns once', () => {
    vi.stubEnv('MUTATION_PREVIEW_TTL_MINUTES', '1440');
    expect(getMutationPreviewTtlMs()).toBe(5 * MINUTE);
    expect(getMutationPreviewTtlMs()).toBe(5 * MINUTE);
    expect(mocks.mockLog).toHaveBeenCalledOnce();
    expect(mocks.mockLog).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warning', message: expect.stringContaining('1440') }),
    );
  });

  it('clamps the previous 30-minute maximum to 5 minutes', () => {
    vi.stubEnv('MUTATION_PREVIEW_TTL_MINUTES', '30');
    expect(getMutationPreviewTtlMs()).toBe(5 * MINUTE);
    vi.stubEnv('MUTATION_PREVIEW_TTL_MINUTES', '5.5');
    expect(getMutationPreviewTtlMs()).toBe(5 * MINUTE);
    expect(mocks.mockLog).toHaveBeenCalledOnce();
    expect(mocks.mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        message: expect.stringContaining('exceeds the maximum of 5'),
      }),
    );
  });

  it('rounds a decimal minute value to an integer number of milliseconds', () => {
    vi.stubEnv('MUTATION_PREVIEW_TTL_MINUTES', '1.17');
    expect(getMutationPreviewTtlMs()).toBe(70_200);
    vi.stubEnv('MUTATION_PREVIEW_TTL_MINUTES', '1.33');
    expect(Number.isSafeInteger(getMutationPreviewTtlMs())).toBe(true);
    expect(getMutationPreviewTtlMs()).toBe(79_800);
  });

  it('falls back to the default for below-min or unparseable values', () => {
    vi.stubEnv('MUTATION_PREVIEW_TTL_MINUTES', '0.5');
    expect(getMutationPreviewTtlMs()).toBe(5 * MINUTE);
    vi.stubEnv('MUTATION_PREVIEW_TTL_MINUTES', 'abc');
    expect(getMutationPreviewTtlMs()).toBe(5 * MINUTE);
  });
});

describe('NoEvidence', () => {
  it('describes itself as kind none with no detail', () => {
    expect(new NoEvidence().describeEvidence()).toEqual({ kind: 'none' });
  });

  it('establish is an inert no-op and verify never allows', async () => {
    const evidence = new NoEvidence();
    await expect(evidence.establish()).resolves.toBeUndefined();
    await expect(evidence.verify()).resolves.toBe(false);
  });
});
