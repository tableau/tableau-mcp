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
    const ctx = makeCtx({ target: { id: 'wb-1', kind: 'workbook' }, tool: 'delete-content' });
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
        tool: 'delete-content',
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

  describe('binding (payload) isolation', () => {
    it('a nonce minted with binding A does not verify with binding B', async () => {
      const evidence = new RegistryEvidence();
      const target: MutationTarget = { id: 'user-1', kind: 'user' };
      await evidence.establish(makeCtx({ target, tool: 'update-user', binding: 'user-1:Viewer' }));
      const nonce = evidence.getEstablishedNonce()!;
      // Different binding (role swap) → must be rejected.
      await expect(
        evidence.verify(
          makeCtx({
            target,
            tool: 'update-user',
            binding: 'user-1:Unlicensed',
            confirmationToken: nonce,
          }),
        ),
      ).resolves.toBe(false);
      // Same binding → accepted.
      await expect(
        evidence.verify(
          makeCtx({
            target,
            tool: 'update-user',
            binding: 'user-1:Viewer',
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
      tool: 'delete-content',
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

  // --- Generalized namespace (the refactor under test) ---
  //
  // The key was changed from `${siteId}:${userLuid}:${tool}:${targetId}` to
  // `${siteId}:${userLuid}:${namespace}:${targetId}`, where `namespace` is a fixed ctor arg (the
  // PREVIEW tool's name) shared by the preview/confirm pair. The `ctx.tool` field is intentionally
  // NOT part of the key for this strategy — the preview tool and its confirm tool run under DIFFERENT
  // tool names, so keying on `ctx.tool` would never match across the pair. These cases pin that
  // behavior and, critically, the cross-namespace ISOLATION the refactor exists to provide.
  describe('generalized namespace', () => {
    it('establish(ns) then verify(ns) for the SAME site/user/target succeeds (explicit namespace)', async () => {
      const establish = new AppApprovalEvidence('delete-datasource');
      const verify = new AppApprovalEvidence('delete-datasource');
      const ctx = appCtx({ target: { id: 'ns-A-target', kind: 'datasource' } });
      await establish.establish(ctx);
      await expect(verify.verify(ctx)).resolves.toBe(true);
    });

    it('WRONG-NAMESPACE ISOLATION: an approval for delete-datasource does NOT satisfy delete-workbook for the SAME site/user/target', async () => {
      // This is the whole point of the refactor: one tool's human approval must never unlock
      // another tool's confirm, even when site + user + target id are identical. Establish under the
      // 'delete-datasource' namespace, then attempt to verify under 'delete-workbook' with the same
      // EvidenceContext → MUST be rejected.
      const sameTargetCtx = appCtx({ target: { id: 'shared-target-id', kind: 'datasource' } });
      await new AppApprovalEvidence('delete-datasource').establish(sameTargetCtx);
      await expect(new AppApprovalEvidence('delete-workbook').verify(sameTargetCtx)).resolves.toBe(
        false,
      );
      // And the genuine namespace still verifies (the approval was recorded, just isolated).
      await expect(
        new AppApprovalEvidence('delete-datasource').verify(sameTargetCtx),
      ).resolves.toBe(true);
    });

    it('isolates every distinct namespace from every other (extract-refresh-task vs update-cloud)', async () => {
      const ctx = appCtx({ target: { id: 'task-shared', kind: 'extract-refresh-task' } });
      await new AppApprovalEvidence('delete-extract-refresh-task').establish(ctx);
      // The update tool's confirm must not be satisfied by the delete tool's approval.
      await expect(
        new AppApprovalEvidence('update-cloud-extract-refresh-task').verify(ctx),
      ).resolves.toBe(false);
    });

    it('default constructor preserves the original behavior (namespace = delete-workbook)', async () => {
      // new AppApprovalEvidence() must key identically to new AppApprovalEvidence('delete-workbook'),
      // so the pre-generalization delete-workbook flow is unchanged. Establish with the default ctor,
      // verify with the explicit 'delete-workbook' namespace → true.
      const ctx = appCtx({ target: { id: 'default-ns-target', kind: 'workbook' } });
      await new AppApprovalEvidence().establish(ctx);
      await expect(new AppApprovalEvidence('delete-workbook').verify(ctx)).resolves.toBe(true);
    });

    it('default constructor is NOT satisfied by a non-delete-workbook namespace', async () => {
      // The mirror of the above: establishing under an explicit non-default namespace must not
      // satisfy the default ('delete-workbook') verify.
      const ctx = appCtx({ target: { id: 'default-ns-iso', kind: 'workbook' } });
      await new AppApprovalEvidence('delete-datasource').establish(ctx);
      await expect(new AppApprovalEvidence().verify(ctx)).resolves.toBe(false);
    });

    it('namespace key ignores ctx.tool entirely (preview/confirm tool names differ but namespace matches)', async () => {
      // Establish as the preview tool would (ctx.tool = 'delete-content') and verify as the
      // confirm tool would (ctx.tool = 'delete-content'); the differing ctx.tool must NOT
      // break the match because the fixed namespace is what keys the entry.
      const target = { id: 'tool-irrelevant', kind: 'datasource' as const };
      await new AppApprovalEvidence('delete-content').establish(
        appCtx({ target, tool: 'delete-content' }),
      );
      await expect(
        new AppApprovalEvidence('delete-content').verify(
          appCtx({ target, tool: 'delete-content' }),
        ),
      ).resolves.toBe(true);
    });

    it('a wrong-namespace verify does NOT consume the genuine approval (isolation is total)', async () => {
      // A rejected cross-namespace verify must be a pure no-op on the real entry — it must not
      // single-use-consume the approval that belongs to the correct namespace.
      const ctx = appCtx({ target: { id: 'no-cross-consume', kind: 'datasource' } });
      await new AppApprovalEvidence('delete-content').establish(ctx);
      // Wrong namespace probe (rejected, and must not touch the real entry).
      await expect(
        new AppApprovalEvidence('update-cloud-extract-refresh-task').verify(ctx),
      ).resolves.toBe(false);
      // The genuine namespace still verifies once...
      await expect(new AppApprovalEvidence('delete-content').verify(ctx)).resolves.toBe(true);
      // ...and is single-use thereafter.
      await expect(new AppApprovalEvidence('delete-content').verify(ctx)).resolves.toBe(false);
    });
  });

  // --- Binding (payload) isolation (regression for the flag-ON schedule-swap defect) ---
  //
  // For a confirm tool that carries a mutable payload (update-cloud-extract-refresh-task's schedule),
  // the approval MUST be bound to the previewed parameters. The bug: approvalKey ignored ctx.binding,
  // so an approval minted while previewing schedule A satisfied a confirm applying schedule B — the
  // human approved X, the client could apply Y. These pin that `binding` is folded into the key.
  describe('binding (payload) isolation', () => {
    it('an approval minted for binding A does NOT satisfy a confirm carrying binding B', async () => {
      const ns = 'update-cloud-extract-refresh-task';
      const target = { id: 'task-bind', kind: 'extract-refresh-task' as const };
      await new AppApprovalEvidence(ns).establish(appCtx({ target, binding: 'schedule-A' }));
      // Different payload → different binding → must be rejected (the swap the bug allowed).
      await expect(
        new AppApprovalEvidence(ns).verify(appCtx({ target, binding: 'schedule-B' })),
      ).resolves.toBe(false);
      // The genuine binding still verifies (the approval was recorded, just bound to A).
      await expect(
        new AppApprovalEvidence(ns).verify(appCtx({ target, binding: 'schedule-A' })),
      ).resolves.toBe(true);
    });

    it('a mismatched-binding verify does NOT consume the genuine approval', async () => {
      const ns = 'update-cloud-extract-refresh-task';
      const target = { id: 'task-bind-noconsume', kind: 'extract-refresh-task' as const };
      await new AppApprovalEvidence(ns).establish(appCtx({ target, binding: 'schedule-A' }));
      // Wrong binding probe (rejected, must not touch the real entry).
      await expect(
        new AppApprovalEvidence(ns).verify(appCtx({ target, binding: 'schedule-B' })),
      ).resolves.toBe(false);
      // Genuine binding still verifies once...
      await expect(
        new AppApprovalEvidence(ns).verify(appCtx({ target, binding: 'schedule-A' })),
      ).resolves.toBe(true);
      // ...and is single-use thereafter.
      await expect(
        new AppApprovalEvidence(ns).verify(appCtx({ target, binding: 'schedule-A' })),
      ).resolves.toBe(false);
    });

    it('absent binding on both sides keeps the delete flow unchanged (key stable)', async () => {
      // The DELETEs pass no binding; establish/verify with binding undefined must still match, so
      // folding binding into the key is a no-op for payload-free targets.
      const target = { id: 'ds-nobind', kind: 'datasource' as const };
      await new AppApprovalEvidence('delete-datasource').establish(appCtx({ target }));
      await expect(
        new AppApprovalEvidence('delete-datasource').verify(appCtx({ target })),
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
    return makeCtx({ target: { id, kind: 'workbook' }, tool: 'delete-content' });
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
