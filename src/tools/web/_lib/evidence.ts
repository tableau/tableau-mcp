import { createHash, randomUUID } from 'node:crypto';

import { RestApi } from '../../../sdks/tableau/restApi.js';
import { createNamespacedStore } from '../../../sessionStore/init.js';
import type { SessionStore } from '../../../sessionStore/sessionStore.js';
import { milliseconds } from '../../../utils/milliseconds.js';
import { parseNumber } from '../../../utils/parseNumber.js';
import { WebToolName } from '../toolName.js';
import { MutationTarget } from './mutationGuard.js';
import { formatPendingDeletionTag, getPendingDeletionMarkers } from './pendingDeletionTag.js';

/**
 * Context handed to an EvidenceStrategy on every guarded mutation. `confirmationToken` is the
 * caller-supplied confirmation value (e.g. the nonce echoed back from a preview), if any.
 */
export type EvidenceTarget = Pick<MutationTarget, 'id'> & Partial<Omit<MutationTarget, 'id'>>;

export interface EvidenceContext {
  restApi: RestApi;
  siteId: string;
  target: EvidenceTarget;
  // The WebToolName, used to namespace registry keys so one tool's evidence can't satisfy another's.
  tool: WebToolName;
  userLuid: string;
  confirmationToken?: string;
  // Optional fingerprint of the mutation's caller-controlled parameters (e.g. a hash of the schedule
  // an update tool would apply). When present it is folded into the RegistryEvidence nonce key, so a
  // nonce minted while previewing parameter set A cannot satisfy a confirm carrying parameter set B —
  // the confirmed mutation is bound to exactly what was previewed. Ignored by TagEvidence/NoEvidence.
  binding?: string;
}

/**
 * Strategy for the server-authoritative proof that a preview ran before a confirmed mutation. Each
 * strategy can only ever REJECT — never wrongly allow — so swapping strategies only changes the kind
 * of friction, never the underlying guarantee that an un-previewed mutation is blocked.
 *
 * - `establish` is called in the preview phase to record server-side proof.
 * - `verify` is called in the confirm phase to re-check that proof against live state.
 * - `describeEvidence` returns the non-sensitive evidence descriptor for the audit record.
 * - `explainRejection` (optional) returns a human-readable note on WHY the last `verify` failed, when
 *   the strategy saw something more specific than "no proof" (e.g. a marker from another batch).
 */
export interface EvidenceStrategy<TTarget> {
  establish(ctx: EvidenceContext): Promise<void>;
  verify(ctx: EvidenceContext): Promise<boolean>;
  describeEvidence(): { kind: 'tag' | 'registry-nonce' | 'none'; detail?: string };
  explainRejection?(): string | undefined;
  // Phantom marker so the target type participates in the strategy's identity; never read.
  readonly _target?: TTarget;
}

/**
 * TagEvidence — the server-authoritative pending-deletion tag gate (#414), batch-scoped (W-24311035).
 *
 * The tag is `pending-deletion-YYYY-MM-DD` for the cleanup batch's UTC date (see
 * pendingDeletionTag.ts). `establish` tags the target with it (reversible, visible in the Tableau
 * UI). `verify` re-fetches the target LIVE and checks THAT EXACT label is present. The tag is
 * server-side state the caller cannot fabricate, so its presence is genuine proof the preview for
 * this batch ran. A marker from a different batch — or the legacy undated `pending-deletion` label —
 * does NOT verify, so a residual tag from an abandoned preview can never silently authorize a later
 * deletion; `explainRejection` names what was seen so the caller understands the rejection.
 */
export class TagEvidence implements EvidenceStrategy<MutationTarget> {
  private readonly pendingTag: string;
  private readonly kind: 'datasource' | 'workbook';
  private rejection?: string;

  constructor({ cleanupDate, kind }: { cleanupDate: string; kind: 'datasource' | 'workbook' }) {
    this.pendingTag = formatPendingDeletionTag(cleanupDate);
    this.kind = kind;
  }

  /** The exact marker label this strategy establishes and verifies. */
  getPendingTag(): string {
    return this.pendingTag;
  }

  async establish(ctx: EvidenceContext): Promise<void> {
    if (this.kind === 'datasource') {
      await ctx.restApi.datasourcesMethods.addTagsToDatasource({
        datasourceId: ctx.target.id,
        siteId: ctx.siteId,
        tagLabels: [this.pendingTag],
      });
    } else {
      await ctx.restApi.workbooksMethods.addTagsToWorkbook({
        workbookId: ctx.target.id,
        siteId: ctx.siteId,
        tagLabels: [this.pendingTag],
      });
    }
  }

  async verify(ctx: EvidenceContext): Promise<boolean> {
    // Query fresh here (not any cached content) so the check reflects the current server state at
    // mutation time. Rejected with zero destructive side effects.
    const tags =
      this.kind === 'datasource'
        ? (
            await ctx.restApi.datasourcesMethods.queryDatasource({
              datasourceId: ctx.target.id,
              siteId: ctx.siteId,
            })
          ).tags
        : (
            await ctx.restApi.workbooksMethods.getWorkbook({
              workbookId: ctx.target.id,
              siteId: ctx.siteId,
            })
          ).tags;
    if (tags?.tag?.some((t) => t.label === this.pendingTag)) {
      this.rejection = undefined;
      return true;
    }
    const others = getPendingDeletionMarkers(tags).map((m) => m.tag);
    this.rejection =
      others.length > 0
        ? `It carries ${others.map((t) => `'${t}'`).join(', ')} from a different cleanup batch, ` +
          `which does not authorize this one (expected '${this.pendingTag}').`
        : undefined;
    return false;
  }

  explainRejection(): string | undefined {
    return this.rejection;
  }

  describeEvidence(): { kind: 'tag'; detail?: string } {
    return { kind: 'tag', detail: `pending-deletion tag '${this.pendingTag}'` };
  }
}

/**
 * The preview→confirm approval window, in milliseconds, from MUTATION_PREVIEW_TTL_MINUTES (default
 * 5, min 1, max 24h) — the same bound RegistryEvidence's nonce store uses. Exported so a preview
 * tool can compute and surface the absolute expiry (`expiresAtMs`) to its UI without duplicating
 * the parse/bounds logic.
 */
export function getMutationPreviewTtlMs(): number {
  const ttlMinutes = parseNumber(process.env.MUTATION_PREVIEW_TTL_MINUTES, {
    defaultValue: 5,
    minValue: 1,
    maxValue: 60 * 24, // 24 hours
  });
  return milliseconds.fromMinutes(ttlMinutes);
}

// Preview proof lives in the configured session store, so with a shared custom store a confirm
// verifies on whichever replica it reaches. Each entry holds its own expiry, checked on verify, so a
// provider that does not apply the namespace TTL still cannot extend the approval window. With the
// default memory store the proof stays process-local: a confirm reaching another process (or after a
// restart) is rejected and the caller re-previews. It can only reject, never wrongly allow.
type PreviewProofStore = SessionStore<number>;

const proofStores = new Map<string, PreviewProofStore>();

function getProofStore(namespace: string): PreviewProofStore {
  let store = proofStores.get(namespace);
  if (!store) {
    // Memoized: on the memory provider every createNamespacedStore call returns a fresh store.
    store = createNamespacedStore<number>(namespace, { ttlMs: getMutationPreviewTtlMs() });
    proofStores.set(namespace, store);
  }
  return store;
}

/** For tests: drop memoized stores so the next use binds to the current session store provider. */
export function resetPreviewProofStores(): void {
  proofStores.clear();
}

function proofKey(fields: ReadonlyArray<string>): string {
  // JSON keeps a delimiter inside one field from shifting into the next; hashing bounds key length
  // and keeps raw ids and nonces out of a shared backend.
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

async function recordProof(namespace: string, key: string): Promise<void> {
  await getProofStore(namespace).set(key, Date.now() + getMutationPreviewTtlMs());
}

async function consumeProof(namespace: string, key: string): Promise<boolean> {
  // consume() is atomic in the store contract, so of two concurrent confirms only one sees the entry.
  const expiresAtMs = await getProofStore(namespace).consume(key);
  return typeof expiresAtMs === 'number' && expiresAtMs > Date.now();
}

const NONCE_NAMESPACE = 'mutation-confirmation-nonces-v1';
const APPROVAL_NAMESPACE = 'mutation-app-approvals-v1';

/**
 * AppApprovalEvidence — proof that a human approved the mutation by a gesture inside a rendered
 * MCP-Apps iframe, within the preview→confirm TTL window. Closes AC-5's residual gap (the tag gate
 * proves a preview RAN, not that a HUMAN approved): the destructive confirm tool is model-invisible
 * (`visibility:['app']`), so the only path that calls `establish`/`verify` is a human click in the
 * iframe — never the LLM.
 *
 * Unlike RegistryEvidence, NOTHING secret is minted, returned, or transported: approval is
 * PRESENCE-based, keyed server-side by site+user+tool+target (all server-known plus the one arg the
 * confirm tool takes) AND the optional `binding` (a fingerprint of the mutation's caller-controlled
 * parameters — see EvidenceContext.binding). `establish` records presence with the TTL; `verify`
 * returns true only if a live, unexpired entry exists and DELETES it (single-use); `confirmationToken`
 * is ignored. Layered ON TOP of the durable tag (the confirm tool also re-checks the tag), this
 * strategy only ever NARROWS access → it can reject, never wrongly allow.
 *
 * Binding the key to `binding` closes a payload-swap gap for confirm tools that carry a mutable
 * payload (e.g. update-cloud-extract-refresh-task's schedule): an approval minted while previewing
 * schedule A must not satisfy a confirm that applies schedule B. Target-only-keyed confirms (the
 * DELETEs, which carry no payload beyond the target id) pass no `binding`, so their key is unchanged.
 */
export class AppApprovalEvidence implements EvidenceStrategy<MutationTarget> {
  // The preview-tool name that namespaces the approval key. The preview tool and its model-invisible
  // confirm tool run as separate WebTool instances under DIFFERENT tool names, so the key must NOT be
  // `ctx.tool` (that would never match across the pair). Instead both sides pass the SAME fixed
  // namespace — the preview tool's name (e.g. 'delete-workbook', 'delete-datasource',
  // 'delete-extract-refresh-task', 'update-cloud-extract-refresh-task') — so each tool's approval is
  // isolated from every other tool's and the preview/confirm pair resolves the same entry.
  private readonly namespace: string;

  // Defaults to 'delete-workbook' to preserve the original (pre-generalization) behavior for the
  // first tool to adopt this strategy. Every NEW tool MUST pass its own preview-tool name so the
  // approvals don't collide on the 'delete-workbook' namespace.
  constructor(namespace: string = 'delete-workbook') {
    this.namespace = namespace;
  }

  private approvalKey(ctx: EvidenceContext): string {
    // The binding keeps an approval minted for parameter set A from satisfying a confirm carrying
    // parameter set B. An empty binding keeps keys stable for payload-free targets like the deletes.
    return proofKey([ctx.siteId, ctx.userLuid, this.namespace, ctx.target.id, ctx.binding ?? '']);
  }

  async establish(ctx: EvidenceContext): Promise<void> {
    await recordProof(APPROVAL_NAMESPACE, this.approvalKey(ctx));
  }

  async verify(ctx: EvidenceContext): Promise<boolean> {
    // Single-use: consuming the approval means it cannot be replayed.
    return consumeProof(APPROVAL_NAMESPACE, this.approvalKey(ctx));
  }

  describeEvidence(): { kind: 'registry-nonce'; detail?: string } {
    // Reuse the audited 'registry-nonce' kind (no schema change); the detail distinguishes it.
    return { kind: 'registry-nonce', detail: 'app-approval (human gesture in MCP-Apps iframe)' };
  }
}

/**
 * RegistryEvidence — server-generated single-use confirmation nonce, for mutations whose target has
 * no durable taggable state (e.g. extract refresh tasks).
 *
 * `establish` generates a fresh nonce via crypto.randomUUID() and records it in the session store
 * under a key scoped to site + user + tool + target + binding; the preview text echoes the nonce so
 * the caller can supply it on confirm. `verify` atomically consumes that exact entry, so a nonce works
 * once, only for what was previewed, and a wrong guess never disturbs a real one. The nonce is
 * server-generated and unguessable, so — like the tag — it cannot be fabricated by computing a value.
 *
 * See the store note above: this can only reject, never wrongly allow.
 */
export class RegistryEvidence implements EvidenceStrategy<MutationTarget> {
  // The nonce minted by the most recent establish(), so the caller (preview branch) can surface it
  // in the response text. NEVER write this into the audit record.
  private lastNonce?: string;

  private static key(ctx: EvidenceContext, nonce: string): string {
    return proofKey([ctx.siteId, ctx.userLuid, ctx.tool, ctx.target.id, ctx.binding ?? '', nonce]);
  }

  async establish(ctx: EvidenceContext): Promise<void> {
    const nonce = randomUUID();
    this.lastNonce = undefined;
    await recordProof(NONCE_NAMESPACE, RegistryEvidence.key(ctx, nonce));
    this.lastNonce = nonce;
  }

  async verify(ctx: EvidenceContext): Promise<boolean> {
    if (!ctx.confirmationToken) {
      return false;
    }
    return consumeProof(NONCE_NAMESPACE, RegistryEvidence.key(ctx, ctx.confirmationToken));
  }

  describeEvidence(): { kind: 'registry-nonce'; detail?: string } {
    // Non-sensitive descriptor only — the raw nonce is never recorded.
    return { kind: 'registry-nonce', detail: 'server-generated single-use confirmation nonce' };
  }

  /** The nonce minted by the last establish(), for the preview response text. Never audited. */
  getEstablishedNonce(): string | undefined {
    return this.lastNonce;
  }
}

/**
 * AllEvidence — AND-composition of several strategies. `verify` is true only when EVERY member
 * verifies; `establish` establishes every member; `explainRejection` delegates to the member that
 * failed. Used by confirm-delete-workbook to require BOTH a
 * live batch `pending-deletion-YYYY-MM-DD` tag (durable, un-forgeable) AND a fresh in-iframe human approval
 * (AppApprovalEvidence) — layering the human-gesture proof ON TOP of the tag so the composite can
 * only ever NARROW access (reject), never wrongly allow.
 *
 * `verify` short-circuits in array order. Place a NON-consuming check (the tag re-fetch) before a
 * single-use one (the approval) so a missing tag never wastes the one-shot approval. For the audit,
 * `describeEvidence` surfaces a 'registry-nonce' member if any is present (the meaningful
 * human-gesture signal), otherwise the first member's kind.
 */
export class AllEvidence implements EvidenceStrategy<MutationTarget> {
  private readonly strategies: ReadonlyArray<EvidenceStrategy<MutationTarget>>;
  private failed?: EvidenceStrategy<MutationTarget>;

  constructor(strategies: ReadonlyArray<EvidenceStrategy<MutationTarget>>) {
    this.strategies = strategies;
  }

  async establish(ctx: EvidenceContext): Promise<void> {
    for (const strategy of this.strategies) {
      await strategy.establish(ctx);
    }
  }

  async verify(ctx: EvidenceContext): Promise<boolean> {
    this.failed = undefined;
    for (const strategy of this.strategies) {
      if (!(await strategy.verify(ctx))) {
        this.failed = strategy;
        return false;
      }
    }
    return true;
  }

  explainRejection(): string | undefined {
    return this.failed?.explainRejection?.();
  }

  describeEvidence(): { kind: 'tag' | 'registry-nonce' | 'none'; detail?: string } {
    const descriptors = this.strategies.map((s) => s.describeEvidence());
    return descriptors.find((d) => d.kind === 'registry-nonce') ?? descriptors[0];
  }
}

/**
 * NoEvidence — for `confirm-only` mutations that gate on a required `confirm: true` flag but have no
 * preview→confirm evidence to establish or verify. The guard never calls establish/verify in
 * confirm-only mode; these are inert no-ops, and the audit record reflects evidence kind 'none'.
 *
 * No production tool currently uses this: update-cloud-extract-refresh-task moved to RegistryEvidence
 * (a schedule-bound single-use nonce) so an un-previewed confirm is rejected server-side. Retained as
 * the strategy for any future confirm-only tool whose target has no verifiable preview state.
 */
export class NoEvidence implements EvidenceStrategy<MutationTarget> {
  async establish(): Promise<void> {
    // No evidence to establish for confirm-only mutations.
  }

  async verify(): Promise<boolean> {
    // Never called by the guard in confirm-only mode.
    return false;
  }

  describeEvidence(): { kind: 'none'; detail?: string } {
    return { kind: 'none' };
  }
}
