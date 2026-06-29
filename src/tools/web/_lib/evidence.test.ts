import { afterEach, beforeEach } from 'vitest';

import { RestApi } from '../../../sdks/tableau/restApi.js';
import {
  AllEvidence,
  AppApprovalEvidence,
  DEFAULT_PENDING_DELETION_TAG,
  EvidenceContext,
  NoEvidence,
  RegistryEvidence,
  TagEvidence,
} from './evidence.js';
import { MutationTarget } from './mutationGuard.js';

// The evidence strategies only ever touch a small slice of RestApi (tag add/query for TagEvidence;
// nothing for RegistryEvidence/NoEvidence), so we hand-build a minimal fake instead of the full SDK.
const mocks = vi.hoisted(() => ({
  mockAddTagsToDatasource: vi.fn(),
  mockQueryDatasource: vi.fn(),
  mockAddTagsToWorkbook: vi.fn(),
  mockGetWorkbook: vi.fn(),
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
    tool: 'delete-datasource',
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

  it('describes itself as a tag with the default label when no tag is supplied', () => {
    const evidence = new TagEvidence({ kind: 'datasource' });
    const descriptor = evidence.describeEvidence();
    expect(descriptor.kind).toBe('tag');
    expect(descriptor.detail).toContain(DEFAULT_PENDING_DELETION_TAG);
  });

  it('falls back to the default tag for empty / whitespace-only labels', () => {
    expect(new TagEvidence({ tag: '   ', kind: 'datasource' }).describeEvidence().detail).toContain(
      DEFAULT_PENDING_DELETION_TAG,
    );
    expect(new TagEvidence({ tag: '', kind: 'workbook' }).describeEvidence().detail).toContain(
      DEFAULT_PENDING_DELETION_TAG,
    );
  });

  it('establish tags the datasource with the (default) pending-deletion label', async () => {
    const evidence = new TagEvidence({ kind: 'datasource' });
    const ctx = makeCtx();
    await evidence.establish(ctx);
    expect(mocks.mockAddTagsToDatasource).toHaveBeenCalledWith({
      datasourceId: 'target-1',
      siteId: 'test-site-id',
      tagLabels: [DEFAULT_PENDING_DELETION_TAG],
    });
  });

  it('establish tags the workbook with a caller-supplied label', async () => {
    const evidence = new TagEvidence({ tag: 'stale-pending', kind: 'workbook' });
    const ctx = makeCtx({ target: { id: 'wb-1', kind: 'workbook' }, tool: 'delete-workbook' });
    await evidence.establish(ctx);
    expect(mocks.mockAddTagsToWorkbook).toHaveBeenCalledWith({
      workbookId: 'wb-1',
      siteId: 'test-site-id',
      tagLabels: ['stale-pending'],
    });
  });

  // --- verify: tag PRESENCE → true, ABSENCE → false (server-authoritative, live re-fetch) ---

  it('verify returns true when the live datasource carries the pending-deletion tag', async () => {
    mocks.mockQueryDatasource.mockResolvedValue({
      tags: { tag: [{ label: DEFAULT_PENDING_DELETION_TAG }] },
    });
    const evidence = new TagEvidence({ kind: 'datasource' });
    await expect(evidence.verify(makeCtx())).resolves.toBe(true);
    // The check is a fresh live re-fetch, not anything cached.
    expect(mocks.mockQueryDatasource).toHaveBeenCalledWith({
      datasourceId: 'target-1',
      siteId: 'test-site-id',
    });
  });

  it('verify returns false when the tag is absent', async () => {
    mocks.mockQueryDatasource.mockResolvedValue({ tags: {} });
    const evidence = new TagEvidence({ kind: 'datasource' });
    await expect(evidence.verify(makeCtx())).resolves.toBe(false);
  });

  it('verify returns false when a DIFFERENT tag is present (must match the requested label)', async () => {
    mocks.mockQueryDatasource.mockResolvedValue({ tags: { tag: [{ label: 'some-other-tag' }] } });
    const evidence = new TagEvidence({ tag: 'stale-pending', kind: 'datasource' });
    await expect(evidence.verify(makeCtx())).resolves.toBe(false);
  });

  it('verify returns true for a workbook carrying the tag', async () => {
    mocks.mockGetWorkbook.mockResolvedValue({
      tags: { tag: [{ label: DEFAULT_PENDING_DELETION_TAG }] },
    });
    const evidence = new TagEvidence({ kind: 'workbook' });
    await expect(
      evidence.verify(makeCtx({ target: { id: 'wb-1', kind: 'workbook' } })),
    ).resolves.toBe(true);
  });

  it('verify returns false when the workbook has no tags object at all', async () => {
    mocks.mockGetWorkbook.mockResolvedValue({});
    const evidence = new TagEvidence({ kind: 'workbook' });
    await expect(
      evidence.verify(makeCtx({ target: { id: 'wb-1', kind: 'workbook' } })),
    ).resolves.toBe(false);
  });
});

describe('RegistryEvidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The TTL is read once when the cache is lazily created (module-level singleton). Keep the
    // default; the single-use + miss behaviors below don't depend on the exact TTL value.
    delete process.env.MUTATION_PREVIEW_TTL_MINUTES;
  });

  it('describes itself as a registry-nonce and NEVER leaks the raw nonce in the descriptor', async () => {
    const evidence = new RegistryEvidence();
    await evidence.establish(makeCtx({ target: { id: 'task-1', kind: 'extract-refresh-task' } }));
    const nonce = evidence.getEstablishedNonce();
    expect(nonce).toBeTruthy();
    const descriptor = evidence.describeEvidence();
    expect(descriptor.kind).toBe('registry-nonce');
    // SECURITY: the audit descriptor must be a non-sensitive description, never the raw nonce.
    expect(descriptor.detail).not.toContain(nonce!);
  });

  it('verify succeeds exactly once for a freshly established nonce, then fails (single-use)', async () => {
    const evidence = new RegistryEvidence();
    const ctx = makeCtx({ target: { id: 'task-1', kind: 'extract-refresh-task' } });
    await evidence.establish(ctx);
    const nonce = evidence.getEstablishedNonce()!;

    const confirmCtx = makeCtx({
      target: { id: 'task-1', kind: 'extract-refresh-task' },
      confirmationToken: nonce,
    });
    // First confirm consumes the nonce.
    await expect(evidence.verify(confirmCtx)).resolves.toBe(true);
    // Replay with the same nonce is rejected — the nonce was deleted on first use.
    await expect(evidence.verify(confirmCtx)).resolves.toBe(false);
  });

  it('verify fails when no confirmation token is supplied', async () => {
    const evidence = new RegistryEvidence();
    const ctx = makeCtx({ target: { id: 'task-2', kind: 'extract-refresh-task' } });
    await evidence.establish(ctx);
    await expect(
      evidence.verify(makeCtx({ target: { id: 'task-2', kind: 'extract-refresh-task' } })),
    ).resolves.toBe(false);
  });

  it('verify fails for a forged / wrong token that was never established', async () => {
    const evidence = new RegistryEvidence();
    await evidence.establish(makeCtx({ target: { id: 'task-3', kind: 'extract-refresh-task' } }));
    await expect(
      evidence.verify(
        makeCtx({
          target: { id: 'task-3', kind: 'extract-refresh-task' },
          confirmationToken: 'forged-precomputed-value',
        }),
      ),
    ).resolves.toBe(false);
  });

  it('scopes nonces by site+user+tool+target so one tool/target cannot satisfy another', async () => {
    const evidence = new RegistryEvidence();
    // Establish for task-A.
    await evidence.establish(makeCtx({ target: { id: 'task-A', kind: 'extract-refresh-task' } }));
    const nonce = evidence.getEstablishedNonce()!;
    // Present the valid nonce but against a DIFFERENT target id → key mismatch → rejected.
    await expect(
      evidence.verify(
        makeCtx({
          target: { id: 'task-B', kind: 'extract-refresh-task' },
          confirmationToken: nonce,
        }),
      ),
    ).resolves.toBe(false);
  });

  it('a nonce established under one tool name does not verify under another tool', async () => {
    const evidence = new RegistryEvidence();
    await evidence.establish(
      makeCtx({
        target: { id: 'task-X', kind: 'extract-refresh-task' },
        tool: 'delete-extract-refresh-task',
      }),
    );
    const nonce = evidence.getEstablishedNonce()!;
    await expect(
      evidence.verify(
        makeCtx({
          target: { id: 'task-X', kind: 'extract-refresh-task' },
          tool: 'update-cloud-extract-refresh-task',
          confirmationToken: nonce,
        }),
      ),
    ).resolves.toBe(false);
  });

  describe('TTL expiry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('rejects a confirm once the nonce has expired (TTL elapsed)', async () => {
      const evidence = new RegistryEvidence();
      const ctx = makeCtx({ target: { id: 'task-ttl', kind: 'extract-refresh-task' } });
      await evidence.establish(ctx);
      const nonce = evidence.getEstablishedNonce()!;

      // The cache TTL defaults to 5 minutes. Advance fake time well past it; ExpiringMap clears the
      // entry via setTimeout, so the confirm can no longer find the nonce.
      await vi.advanceTimersByTimeAsync(1000 * 60 * 6);

      await expect(
        evidence.verify(
          makeCtx({
            target: { id: 'task-ttl', kind: 'extract-refresh-task' },
            confirmationToken: nonce,
          }),
        ),
      ).resolves.toBe(false);
    });

    it('still verifies a nonce that has not yet expired', async () => {
      const evidence = new RegistryEvidence();
      const ctx = makeCtx({ target: { id: 'task-fresh', kind: 'extract-refresh-task' } });
      await evidence.establish(ctx);
      const nonce = evidence.getEstablishedNonce()!;

      // Advance under the 5-minute TTL — the nonce is still live.
      await vi.advanceTimersByTimeAsync(1000 * 60 * 2);

      await expect(
        evidence.verify(
          makeCtx({
            target: { id: 'task-fresh', kind: 'extract-refresh-task' },
            confirmationToken: nonce,
          }),
        ),
      ).resolves.toBe(true);
    });
  });
});

describe('AppApprovalEvidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MUTATION_PREVIEW_TTL_MINUTES;
  });

  // The app-approval registry is module-scoped and shared across instances (the preview tool and
  // the confirm tool are separate WebTool instances but must hit the same store). Use distinct
  // target ids per test so cases don't bleed into one another.
  function appCtx(overrides: Partial<EvidenceContext> = {}): EvidenceContext {
    return makeCtx({
      target: { id: 'wb-app', kind: 'workbook' },
      tool: 'delete-workbook',
      userLuid: 'user-1',
      ...overrides,
    });
  }

  it('describes itself as a registry-nonce with a human-gesture detail and leaks no secret', () => {
    const descriptor = new AppApprovalEvidence().describeEvidence();
    expect(descriptor.kind).toBe('registry-nonce');
    expect(descriptor.detail).toContain('app-approval');
  });

  it('establish records presence so a later verify (single-use) succeeds exactly once', async () => {
    const evidence = new AppApprovalEvidence();
    const ctx = appCtx({ target: { id: 'wb-once', kind: 'workbook' } });
    await evidence.establish(ctx);

    // A separate instance (mirrors confirm tool ≠ preview tool) sharing the module registry.
    const confirm = new AppApprovalEvidence();
    const confirmCtx = appCtx({ target: { id: 'wb-once', kind: 'workbook' } });
    await expect(confirm.verify(confirmCtx)).resolves.toBe(true);
    // Single-use: the approval is consumed on first verify, so a replay is rejected.
    await expect(confirm.verify(confirmCtx)).resolves.toBe(false);
  });

  it('verify fails when no approval was ever established (no human gesture)', async () => {
    const evidence = new AppApprovalEvidence();
    await expect(
      evidence.verify(appCtx({ target: { id: 'wb-never', kind: 'workbook' } })),
    ).resolves.toBe(false);
  });

  it('ignores any caller-supplied confirmationToken — approval is presence-based, not transported', async () => {
    const evidence = new AppApprovalEvidence();
    // A caller that forges a token but never previewed in the iframe must still be rejected.
    await expect(
      evidence.verify(
        appCtx({ target: { id: 'wb-forge', kind: 'workbook' }, confirmationToken: 'anything' }),
      ),
    ).resolves.toBe(false);
  });

  it('scopes approval by site+user+tool+target so a different target is not satisfied', async () => {
    const evidence = new AppApprovalEvidence();
    await evidence.establish(appCtx({ target: { id: 'wb-A', kind: 'workbook' } }));
    await expect(
      evidence.verify(appCtx({ target: { id: 'wb-B', kind: 'workbook' } })),
    ).resolves.toBe(false);
  });

  it('scopes approval by user so another user cannot consume it', async () => {
    const evidence = new AppApprovalEvidence();
    await evidence.establish(
      appCtx({ target: { id: 'wb-user', kind: 'workbook' }, userLuid: 'user-1' }),
    );
    await expect(
      evidence.verify(appCtx({ target: { id: 'wb-user', kind: 'workbook' }, userLuid: 'user-2' })),
    ).resolves.toBe(false);
  });

  describe('TTL expiry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('rejects a confirm once the approval window (TTL) has elapsed — must re-preview', async () => {
      const evidence = new AppApprovalEvidence();
      await evidence.establish(appCtx({ target: { id: 'wb-ttl', kind: 'workbook' } }));
      // TTL defaults to 5 minutes; advance past it so the approval auto-expires.
      await vi.advanceTimersByTimeAsync(1000 * 60 * 6);
      await expect(
        evidence.verify(appCtx({ target: { id: 'wb-ttl', kind: 'workbook' } })),
      ).resolves.toBe(false);
    });

    it('still verifies an approval that has not yet expired', async () => {
      const evidence = new AppApprovalEvidence();
      await evidence.establish(appCtx({ target: { id: 'wb-fresh', kind: 'workbook' } }));
      await vi.advanceTimersByTimeAsync(1000 * 60 * 2);
      await expect(
        evidence.verify(appCtx({ target: { id: 'wb-fresh', kind: 'workbook' } })),
      ).resolves.toBe(true);
    });
  });
});

describe('AllEvidence (AND-composition)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MUTATION_PREVIEW_TTL_MINUTES;
    mocks.mockGetWorkbook.mockResolvedValue({
      tags: { tag: [{ label: DEFAULT_PENDING_DELETION_TAG }] },
    });
  });

  function appCtx(id: string): EvidenceContext {
    return makeCtx({ target: { id, kind: 'workbook' }, tool: 'confirm-delete-workbook' });
  }

  it('verify is true only when EVERY strategy verifies (tag present AND approval present)', async () => {
    const approval = new AppApprovalEvidence();
    await approval.establish(appCtx('wb-and-ok'));
    const all = new AllEvidence([new TagEvidence({ kind: 'workbook' }), approval]);
    await expect(all.verify(appCtx('wb-and-ok'))).resolves.toBe(true);
  });

  it('verify is false when the tag is missing even if the approval is present', async () => {
    mocks.mockGetWorkbook.mockResolvedValue({ tags: { tag: [{ label: 'other' }] } });
    const approval = new AppApprovalEvidence();
    await approval.establish(appCtx('wb-and-notag'));
    const all = new AllEvidence([new TagEvidence({ kind: 'workbook' }), approval]);
    await expect(all.verify(appCtx('wb-and-notag'))).resolves.toBe(false);
  });

  it('verify is false when no human approval exists even if the tag is present', async () => {
    const all = new AllEvidence([new TagEvidence({ kind: 'workbook' }), new AppApprovalEvidence()]);
    await expect(all.verify(appCtx('wb-and-noapproval'))).resolves.toBe(false);
  });

  it('describes itself with the kind of its primary (first) strategy for the audit record', () => {
    const all = new AllEvidence([new AppApprovalEvidence(), new TagEvidence({ kind: 'workbook' })]);
    expect(all.describeEvidence().kind).toBe('registry-nonce');
  });
});

describe('getMutationPreviewTtlMs', () => {
  afterEach(() => {
    delete process.env.MUTATION_PREVIEW_TTL_MINUTES;
  });

  it('defaults to 5 minutes', async () => {
    delete process.env.MUTATION_PREVIEW_TTL_MINUTES;
    const { getMutationPreviewTtlMs } = await import('./evidence.js');
    expect(getMutationPreviewTtlMs()).toBe(1000 * 60 * 5);
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
