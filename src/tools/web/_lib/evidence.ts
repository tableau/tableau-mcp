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
  // Fold the optional parameter fingerprint into the key so a nonce is valid only for a confirm that
  // carries the same caller-controlled parameters that were previewed. `binding` is a non-secret hash
  // (see EvidenceContext.binding); an empty segment when absent keeps keys stable for taggable/no-arg
  // targets like deletes.
  return `${ctx.siteId}:${ctx.userLuid}:${ctx.tool}:${ctx.target.id}:${ctx.binding ?? ''}`;
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
