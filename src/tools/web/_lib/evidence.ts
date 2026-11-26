import { log } from '../../../logging/logger.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { milliseconds } from '../../../utils/milliseconds.js';
import { parseNumber } from '../../../utils/parseNumber.js';
import { WebToolName } from '../toolName.js';
import { MutationTarget } from './mutationGuard.js';
import { formatPendingDeletionTag, getPendingDeletionMarkers } from './pendingDeletionTag.js';

/**
 * Context handed to an EvidenceStrategy on every guarded mutation. `confirmationToken` is the
 * caller-supplied confirmation value (e.g. the signed token echoed back from a preview), if any.
 */
export type EvidenceTarget = Pick<MutationTarget, 'id'> & Partial<Omit<MutationTarget, 'id'>>;

export interface EvidenceContext {
  restApi: RestApi;
  siteId: string;
  target: EvidenceTarget;
  // The WebToolName, used to namespace the evidence so one tool's evidence can't satisfy another's.
  tool: WebToolName;
  userLuid: string;
  confirmationToken?: string;
  // Optional fingerprint of the mutation's caller-controlled parameters (e.g. a hash of the schedule
  // an update tool would apply). When present it is signed into the SignedTokenEvidence token, so a
  // token minted while previewing parameter set A cannot satisfy a confirm carrying parameter set B —
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
 * - `release` (optional) undoes the consuming side effect of the last SUCCESSFUL `verify` (e.g. a
 *   replay-cache entry). The guard calls it when the mutation does not proceed after a verify passed
 *   (a target-state precondition rejected), so that rejection does not burn the caller's proof.
 * - `precheck` (optional) is a cheap, synchronous, I/O-free check of the caller-supplied
 *   confirmation value on its own (e.g. "is this a well-formed signed token"). It can only reject:
 *   false means `verify` would certainly fail, so the guard rejects the confirm BEFORE resolving the
 *   target (no REST reads for a confirm that cannot pass). Omitted = no precheck.
 */
/** Audit-record evidence kinds (mirrors auditRecordSchema.confirmationEvidence.kind). */
export type EvidenceKind = 'tag' | 'signed-token' | 'registry-nonce' | 'none';

export interface EvidenceStrategy<TTarget> {
  establish(ctx: EvidenceContext): Promise<void>;
  verify(ctx: EvidenceContext): Promise<boolean>;
  describeEvidence(): { kind: EvidenceKind; detail?: string };
  explainRejection?(): string | undefined;
  release?(): void;
  precheck?(confirmationToken: string | undefined): boolean;
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

/** Default / bounds of MUTATION_PREVIEW_TTL_MINUTES. */
export const MUTATION_PREVIEW_TTL_DEFAULT_MINUTES = 5;
export const MUTATION_PREVIEW_TTL_MIN_MINUTES = 1;
// The replay guard is per-replica, so across replicas a signed token is replayable until it
// expires: the TTL IS the cross-replica replay window. Keep it short — capped at 5 minutes per the
// product-security review of the signed-token design (W-25002517); the default is also the max.
export const MUTATION_PREVIEW_TTL_MAX_MINUTES = 5;

let ttlClampWarned = false;

/**
 * The preview→confirm approval window, in milliseconds, from MUTATION_PREVIEW_TTL_MINUTES (default
 * 5, min 1, max 5) — the same bound the signed confirmation tokens use. Exported so a preview
 * tool can compute and surface the absolute expiry (`expiresAtMs`) to its UI without duplicating
 * the parse/bounds logic.
 *
 * A value ABOVE the max is clamped to the max (not silently reset to the default) and logged once
 * as a warning: an operator who asked for a long window gets the longest allowed one. Unparseable
 * or below-min values fall back to the default (parseNumber semantics). The result is rounded to
 * an integer number of milliseconds (a decimal setting such as 1.17 is accepted).
 */
export function getMutationPreviewTtlMs(): number {
  const raw = process.env.MUTATION_PREVIEW_TTL_MINUTES;
  const requested = raw ? parseFloat(raw) : NaN;
  if (!isNaN(requested) && requested > MUTATION_PREVIEW_TTL_MAX_MINUTES) {
    if (!ttlClampWarned) {
      ttlClampWarned = true;
      log({
        message:
          `MUTATION_PREVIEW_TTL_MINUTES=${requested} exceeds the maximum of ` +
          `${MUTATION_PREVIEW_TTL_MAX_MINUTES}; using ${MUTATION_PREVIEW_TTL_MAX_MINUTES} minutes.`,
        level: 'warning',
        logger: 'startup',
      });
    }
    return milliseconds.fromMinutes(MUTATION_PREVIEW_TTL_MAX_MINUTES);
  }
  const ttlMinutes = parseNumber(raw, {
    defaultValue: MUTATION_PREVIEW_TTL_DEFAULT_MINUTES,
    minValue: MUTATION_PREVIEW_TTL_MIN_MINUTES,
    maxValue: MUTATION_PREVIEW_TTL_MAX_MINUTES,
  });
  // A decimal minute value (e.g. 1.17) yields a fractional product (70199.99999999999); the token
  // codec requires an integer TTL, so round at this config boundary.
  return Math.round(milliseconds.fromMinutes(ttlMinutes));
}

export const evidenceExportedForTesting = {
  resetTtlClampWarning(): void {
    ttlClampWarned = false;
  },
};

/**
 * AllEvidence — AND-composition of several strategies. `verify` is true only when EVERY member
 * verifies; `establish` establishes every member; `explainRejection` delegates to the member that
 * failed. Used by confirm-delete-content to require BOTH a
 * live batch `pending-deletion-YYYY-MM-DD` tag (durable, un-forgeable) AND a signed in-iframe human
 * approval token (createAppApprovalEvidence, see appApproval.ts) — layering the human-gesture proof ON TOP of the tag so the composite can
 * only ever NARROW access (reject), never wrongly allow.
 *
 * `verify` short-circuits in array order. Place a NON-consuming check (the tag re-fetch) before a
 * replay-guarded one (the approval token) so a missing tag never burns the approval token. A
 * target-state precondition the guard runs AFTER verify (e.g. delete-content's "still stale" check)
 * does not burn it either: on a precondition rejection the guard calls `release`, which every member
 * that verified forwards to its own `release` (removing the approval token's replay-cache entry).
 * For the audit, `describeEvidence` surfaces a 'signed-token' member if any is present (the
 * meaningful human-gesture signal), otherwise the first member's kind.
 */
export class AllEvidence implements EvidenceStrategy<MutationTarget> {
  private readonly strategies: ReadonlyArray<EvidenceStrategy<MutationTarget>>;
  private failed?: EvidenceStrategy<MutationTarget>;
  private verified: Array<EvidenceStrategy<MutationTarget>> = [];

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
    this.verified = [];
    for (const strategy of this.strategies) {
      if (!(await strategy.verify(ctx))) {
        this.failed = strategy;
        // A later member rejected: undo any earlier member's consumption so the composite as a
        // whole consumes nothing on a rejection.
        this.release();
        return false;
      }
      this.verified.push(strategy);
    }
    return true;
  }

  /** Rejects when any member's precheck rejects (members without one pass). */
  precheck(confirmationToken: string | undefined): boolean {
    for (const strategy of this.strategies) {
      if (strategy.precheck && !strategy.precheck(confirmationToken)) {
        this.failed = strategy;
        return false;
      }
    }
    return true;
  }

  release(): void {
    for (const strategy of this.verified) {
      strategy.release?.();
    }
    this.verified = [];
  }

  explainRejection(): string | undefined {
    return this.failed?.explainRejection?.();
  }

  describeEvidence(): { kind: EvidenceKind; detail?: string } {
    const descriptors = this.strategies.map((s) => s.describeEvidence());
    return descriptors.find((d) => d.kind === 'signed-token') ?? descriptors[0];
  }
}

/**
 * NoEvidence — for `confirm-only` mutations that gate on a required `confirm: true` flag but have no
 * preview→confirm evidence to establish or verify. The guard never calls establish/verify in
 * confirm-only mode; these are inert no-ops, and the audit record reflects evidence kind 'none'.
 *
 * No production tool currently uses this: update-cloud-extract-refresh-task moved to a schedule-bound
 * signed confirmation token so an un-previewed confirm is rejected server-side. Retained as
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
