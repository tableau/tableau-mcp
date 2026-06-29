import { randomUUID } from 'node:crypto';

import { RestApi } from '../../../sdks/tableau/restApi.js';
import { ExpiringMap } from '../../../utils/expiringMap.js';
import { milliseconds } from '../../../utils/milliseconds.js';
import { parseNumber } from '../../../utils/parseNumber.js';
import { WebToolName } from '../toolName.js';
import { MutationTarget } from './mutationGuard.js';

// Default tag applied during the preview phase to mark content as pending deletion. Reversible and
// visible in the Tableau UI, giving owners a window to object before the confirmed delete. Generic
// by design — callers (e.g. the Stale Content Cleanup prompt) override via `tag`. Lifted here from
// the delete tools so the tag-gate vocabulary lives next to the evidence strategy that enforces it.
export const DEFAULT_PENDING_DELETION_TAG = 'pending-deletion';

/**
 * Context handed to an EvidenceStrategy on every guarded mutation. `confirmationToken` is the
 * caller-supplied confirmation value (e.g. the nonce echoed back from a preview), if any.
 */
export interface EvidenceContext {
  restApi: RestApi;
  siteId: string;
  target: MutationTarget;
  // The WebToolName, used to namespace registry keys so one tool's evidence can't satisfy another's.
  tool: WebToolName;
  userLuid: string;
  confirmationToken?: string;
}

/**
 * Strategy for the server-authoritative proof that a preview ran before a confirmed mutation. Each
 * strategy can only ever REJECT — never wrongly allow — so swapping strategies only changes the kind
 * of friction, never the underlying guarantee that an un-previewed mutation is blocked.
 *
 * - `establish` is called in the preview phase to record server-side proof.
 * - `verify` is called in the confirm phase to re-check that proof against live state.
 * - `describeEvidence` returns the non-sensitive evidence descriptor for the audit record.
 */
export interface EvidenceStrategy<TTarget> {
  establish(ctx: EvidenceContext): Promise<void>;
  verify(ctx: EvidenceContext): Promise<boolean>;
  describeEvidence(): { kind: 'tag' | 'registry-nonce' | 'none'; detail?: string };
  // Phantom marker so the target type participates in the strategy's identity; never read.
  readonly _target?: TTarget;
}

/**
 * TagEvidence — the server-authoritative pending-deletion tag gate (lifted verbatim from #414).
 *
 * `establish` tags the target with the pending-deletion label (reversible, visible in the Tableau
 * UI). `verify` re-fetches the target LIVE and checks the tag is present. The tag is server-side
 * state the caller cannot fabricate, so its presence is genuine proof the preview ran — unlike a
 * caller-computable confirmation token, this gate cannot be bypassed by deriving a value.
 */
export class TagEvidence implements EvidenceStrategy<MutationTarget> {
  private readonly pendingTag: string;
  private readonly kind: 'datasource' | 'workbook';

  constructor({ tag, kind }: { tag?: string; kind: 'datasource' | 'workbook' }) {
    // Treat undefined, empty, and whitespace-only tags as "use the default" so a blank label never
    // gets applied (preview) or verified against (confirm).
    this.pendingTag = tag?.trim() ? tag : DEFAULT_PENDING_DELETION_TAG;
    this.kind = kind;
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
    if (this.kind === 'datasource') {
      const datasource = await ctx.restApi.datasourcesMethods.queryDatasource({
        datasourceId: ctx.target.id,
        siteId: ctx.siteId,
      });
      return datasource.tags?.tag?.some((t) => t.label === this.pendingTag) ?? false;
    }
    const workbook = await ctx.restApi.workbooksMethods.getWorkbook({
      workbookId: ctx.target.id,
      siteId: ctx.siteId,
    });
    return workbook.tags?.tag?.some((t) => t.label === this.pendingTag) ?? false;
  }

  describeEvidence(): { kind: 'tag'; detail?: string } {
    return { kind: 'tag', detail: `pending-deletion tag '${this.pendingTag}'` };
  }
}

// Lazy-initialized registry of server-generated single-use confirmation nonces, keyed
// `${siteId}:${userLuid}:${tool}:${targetId}`. Copied from adminGate.ts's getCache() pattern
// (parseNumber + milliseconds.fromMinutes + ExpiringMap) to avoid a module-level parseNumber call.
//
// DURABILITY CAVEAT: this is in-memory, so it is NOT durable across a server restart and is NOT
// shared across multiple instances. The consequence is asymmetric and safe: a lost/absent nonce can
// only cause a confirm to be REJECTED (the caller must re-preview), never wrongly ALLOWED. It is
// therefore strictly more friction and preserves the no-bypass guarantee. Contrast TagEvidence,
// whose proof lives in durable Tableau server-side state.
let nonceCache: ExpiringMap<string, string> | null = null;

function getCache(): ExpiringMap<string, string> {
  if (!nonceCache) {
    const ttlMinutes = parseNumber(process.env.MUTATION_PREVIEW_TTL_MINUTES, {
      defaultValue: 5,
      minValue: 1,
      maxValue: 60 * 24, // 24 hours
    });
    nonceCache = new ExpiringMap<string, string>({
      defaultExpirationTimeMs: milliseconds.fromMinutes(ttlMinutes),
    });
  }
  return nonceCache;
}

function nonceKey(ctx: EvidenceContext): string {
  return `${ctx.siteId}:${ctx.userLuid}:${ctx.tool}:${ctx.target.id}`;
}

/**
 * The preview→confirm approval window, in milliseconds, from MUTATION_PREVIEW_TTL_MINUTES (default
 * 5, min 1, max 24h) — the same bound RegistryEvidence's nonce cache uses. Exported so a preview
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

// Lazy-initialized registry of in-iframe human approvals, keyed identically to the nonce cache
// (`${siteId}:${userLuid}:${tool}:${targetId}`) but storing only PRESENCE — there is no secret to
// transport. Kept separate from `nonceCache` so the two strategies never collide on a key. Same
// DURABILITY CAVEAT applies: in-memory, so a lost entry can only force a re-preview (reject), never
// wrongly allow.
let approvalCache: ExpiringMap<string, true> | null = null;

function getApprovalCache(): ExpiringMap<string, true> {
  if (!approvalCache) {
    approvalCache = new ExpiringMap<string, true>({
      defaultExpirationTimeMs: getMutationPreviewTtlMs(),
    });
  }
  return approvalCache;
}

/**
 * AppApprovalEvidence — proof that a human approved the mutation by a gesture inside a rendered
 * MCP-Apps iframe, within the preview→confirm TTL window. Closes AC-5's residual gap (the tag gate
 * proves a preview RAN, not that a HUMAN approved): the destructive confirm tool is model-invisible
 * (`visibility:['app']`), so the only path that calls `establish`/`verify` is a human click in the
 * iframe — never the LLM.
 *
 * Unlike RegistryEvidence, NOTHING secret is minted, returned, or transported: approval is
 * PRESENCE-based, keyed server-side by site+user+tool+target (all server-known plus the one arg the
 * confirm tool takes). `establish` records presence with the TTL; `verify` returns true only if a
 * live, unexpired entry exists and DELETES it (single-use); `confirmationToken` is ignored. Layered
 * ON TOP of the durable tag (the confirm tool also re-checks the tag), this strategy only ever
 * NARROWS access → it can reject, never wrongly allow.
 */
export class AppApprovalEvidence implements EvidenceStrategy<MutationTarget> {
  // Keyed by site+user+target under a FIXED `delete-workbook` namespace (NOT ctx.tool) so the
  // preview tool (delete-workbook) and the confirm tool (confirm-delete-workbook) — which run as
  // separate WebTool instances under different tool names — resolve the SAME approval entry.
  private approvalKey(ctx: EvidenceContext): string {
    return `${ctx.siteId}:${ctx.userLuid}:delete-workbook:${ctx.target.id}`;
  }

  async establish(ctx: EvidenceContext): Promise<void> {
    getApprovalCache().set(this.approvalKey(ctx), true);
  }

  async verify(ctx: EvidenceContext): Promise<boolean> {
    const key = this.approvalKey(ctx);
    if (!getApprovalCache().get(key)) {
      return false;
    }
    // Single-use: consume the approval so it cannot be replayed.
    getApprovalCache().delete(key);
    return true;
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
 * `establish` generates a fresh nonce via crypto.randomUUID() and stores it under a key scoped to
 * site + user + tool + target; the preview text echoes the nonce so the caller can supply it on
 * confirm. `verify` checks the supplied nonce matches the stored one AND deletes it (single-use), so
 * a nonce can never be replayed. The nonce is server-generated and unguessable, so — like the tag —
 * it cannot be fabricated by computing a value.
 *
 * See the DURABILITY CAVEAT on the registry cache above: this can only reject, never wrongly allow.
 */
export class RegistryEvidence implements EvidenceStrategy<MutationTarget> {
  // The nonce minted by the most recent establish(), so the caller (preview branch) can surface it
  // in the response text. NEVER write this into the audit record.
  private lastNonce?: string;

  async establish(ctx: EvidenceContext): Promise<void> {
    const nonce = randomUUID();
    getCache().set(nonceKey(ctx), nonce);
    this.lastNonce = nonce;
  }

  async verify(ctx: EvidenceContext): Promise<boolean> {
    const key = nonceKey(ctx);
    const stored = getCache().get(key);
    if (!stored || !ctx.confirmationToken || stored !== ctx.confirmationToken) {
      return false;
    }
    // Single-use: consume the nonce so it cannot be replayed.
    getCache().delete(key);
    return true;
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
 * verifies; `establish` establishes every member. Used by confirm-delete-workbook to require BOTH a
 * live `pending-deletion` tag (durable, un-forgeable) AND a fresh in-iframe human approval
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

  constructor(strategies: ReadonlyArray<EvidenceStrategy<MutationTarget>>) {
    this.strategies = strategies;
  }

  async establish(ctx: EvidenceContext): Promise<void> {
    for (const strategy of this.strategies) {
      await strategy.establish(ctx);
    }
  }

  async verify(ctx: EvidenceContext): Promise<boolean> {
    for (const strategy of this.strategies) {
      if (!(await strategy.verify(ctx))) {
        return false;
      }
    }
    return true;
  }

  describeEvidence(): { kind: 'tag' | 'registry-nonce' | 'none'; detail?: string } {
    const descriptors = this.strategies.map((s) => s.describeEvidence());
    return descriptors.find((d) => d.kind === 'registry-nonce') ?? descriptors[0];
  }
}

/**
 * NoEvidence — for `confirm-only` mutations (e.g. update-cloud-extract-refresh-task) that gate on a
 * required `confirm: true` flag but have no preview→confirm evidence to establish or verify. The
 * guard never calls establish/verify in confirm-only mode; these are inert no-ops, and the audit
 * record reflects evidence kind 'none'.
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
