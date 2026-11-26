/**
 * SignedConfirmation — the one shared preview→confirm helper for every mutation tool that gates on a
 * server-signed, short-lived confirmation token (SignedTokenEvidence).
 *
 * A tool declares only WHAT it confirms: its tool name, the target id (+ a human label for messages),
 * the parameter binding, an optional `resolveState()` (the target's live pre-state), and its preview
 * wording. The helper owns HOW: minting and verifying the token, rendering the "NEXT STEP" text,
 * raising PreviewNotRunError (with the evidence's explainRejection detail), and the audit descriptor
 * (`kind: 'signed-token'`, fixed detail, never the token).
 *
 * Two ways to use it:
 * - Through guardMutation (admin tools: update-user, update-cloud-extract-refresh-task, the
 *   extract-task branch of delete-content): pass `confirmation.evidence` as the guard's `evidence`.
 *   The guard resolves the target (whose `state` it binds), establishes / verifies, raises
 *   PreviewNotRunError and audits. After a preview, call `confirmation.nextStep()` for the text.
 * - Standalone (flow tools: run-flow, run-flow-task, cancel-flow-run, which have no admin gate and no
 *   audit record): call `preview()` / `confirm()`. `resolveState()` runs on BOTH phases; if it throws
 *   the error propagates (fail closed — no token is minted, nothing is mutated). On confirm the
 *   token is authenticated first (shape, expiry, MAC over its own pre-state field, same-replica
 *   replay) WITHOUT calling `resolveState()`: a missing, forged, expired or replayed token costs no
 *   REST call, and `state-changed` is only reported for an authentic, unexpired token. Wrap the
 *   mutating REST call in `confirmAndRun()` so a definite 4xx (nothing applied) releases the token,
 *   the same rule guardMutation's recordOutcome applies.
 *
 * Keep the wording here, not at call sites, so every signed-token tool says the same thing:
 * "short-lived token bound to this change" (NOT "single-use" — see signedTokenEvidence.ts for the
 * residual cross-replica replay window).
 */
import { PreviewNotRunError } from '../../../errors/mcpToolError.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { getHttpStatusCode } from '../../../utils/getHttpStatus.js';
import { WebToolName } from '../toolName.js';
import { EvidenceContext } from './evidence.js';
import { renderPreviewNotRunMessage, renderTokenConfirmNextStep } from './hitlText.js';
import { isDefiniteNotAppliedStatus } from './mutationGuard.js';
import { SignedTokenEvidence, SignedTokenEvidenceOptions } from './signedTokenEvidence.js';

/** The preview "NEXT STEP" wording a tool supplies (see renderTokenConfirmNextStep). */
export interface SignedConfirmationText {
  /** Imperative clause naming what to present, e.g. "present this change". */
  subject: string;
  /** The confirm-verb clause, e.g. "confirm it. Do NOT apply". */
  approvalClause: string;
  /** Trailing gate clause, starting right after the token phrase, e.g. " before applying the update)." */
  tail: string;
}

export interface SignedConfirmationSpec {
  tool: WebToolName;
  targetId: string;
  /** Human label for the target in rejection messages, e.g. 'flow', 'flow run'. */
  targetKind: string;
  /** Fingerprint of the caller-controlled parameters ('' / omitted when none). */
  binding?: string;
  /**
   * Live pre-state of the target, read on preview AND confirm (standalone use only; through
   * guardMutation the state comes from `resolveTarget().state`). A change in between rejects the
   * confirm with the state-changed explanation. Throwing fails closed.
   */
  resolveState?: () => Promise<string>;
  text: SignedConfirmationText;
}

/** The authenticated identity a token is bound to (with the REST client for the evidence context). */
export interface SignedConfirmationCaller {
  restApi: RestApi;
  userLuid: string;
}

export class SignedConfirmation {
  /** The EvidenceStrategy to hand to guardMutation. Also used internally by preview()/confirm(). */
  readonly evidence: SignedTokenEvidence;
  private readonly spec: SignedConfirmationSpec;

  constructor(spec: SignedConfirmationSpec, options: SignedTokenEvidenceOptions = {}) {
    this.spec = spec;
    this.evidence = new SignedTokenEvidence(options);
  }

  /** The evidence context without the live pre-state (no REST call). */
  private baseContext(
    { restApi, userLuid }: SignedConfirmationCaller,
    confirmationToken?: string,
  ): EvidenceContext {
    return {
      restApi,
      siteId: restApi.siteId,
      target: { id: this.spec.targetId },
      tool: this.spec.tool,
      userLuid,
      confirmationToken,
      binding: this.spec.binding,
    };
  }

  /** The full evidence context: baseContext plus the live pre-state from resolveState() (REST). */
  private async context(
    caller: SignedConfirmationCaller,
    confirmationToken?: string,
  ): Promise<EvidenceContext> {
    const base = this.baseContext(caller, confirmationToken);
    const state = this.spec.resolveState ? await this.spec.resolveState() : undefined;
    return state === undefined ? base : { ...base, target: { ...base.target, state } };
  }

  /** The preview "NEXT STEP" text carrying the token minted by the last establish. */
  nextStep(): string {
    return renderTokenConfirmNextStep({
      ...this.spec.text,
      nonce: this.evidence.getEstablishedNonce(),
    });
  }

  /** Standalone preview: resolve the pre-state, mint the token, return the NEXT STEP text. */
  async preview(caller: SignedConfirmationCaller): Promise<string> {
    await this.evidence.establish(await this.context(caller));
    return this.nextStep();
  }

  /**
   * Standalone confirm: authenticate the token, then re-resolve the pre-state and verify. Throws
   * PreviewNotRunError (with the state-changed detail when that is why) on any failure; resolves
   * only when the caller may mutate.
   */
  async confirm(
    caller: SignedConfirmationCaller,
    confirmationToken: string | undefined,
  ): Promise<void> {
    // Authenticate BEFORE resolveState(): a missing, garbage, forged, expired or replayed token
    // costs no REST lookup, and the "run the preview first" message is not masked by a lookup
    // error. The MAC covers the pre-state taken from the token itself, so it is checkable before
    // the live read; verify() then compares that pre-state with the live one (and re-checks all).
    if (
      this.evidence.preVerify(this.baseContext(caller, confirmationToken)) &&
      (await this.evidence.verify(await this.context(caller, confirmationToken)))
    ) {
      return;
    }
    throw new PreviewNotRunError(
      renderPreviewNotRunMessage({
        tool: this.spec.tool,
        targetKind: this.spec.targetKind,
        targetId: this.spec.targetId,
        detail: this.evidence.explainRejection(),
      }),
    );
  }

  /**
   * Standalone confirm + mutate: confirm() the token, then run the mutating REST call. When `run`
   * fails with a DEFINITE client error (4xx other than 408 — the request was rejected, nothing was
   * applied; see isDefiniteNotAppliedStatus) the token's replay-cache entry is released so the
   * caller can retry with the same token, matching guardMutation's recordOutcome. A 5xx, 408,
   * timeout, network error or status-less error keeps it consumed (the outcome is unknown). The
   * error is always rethrown.
   */
  async confirmAndRun<T>(
    caller: SignedConfirmationCaller,
    confirmationToken: string | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    await this.confirm(caller, confirmationToken);
    try {
      return await run();
    } catch (e) {
      if (isDefiniteNotAppliedStatus(getHttpStatusCode(e))) {
        this.evidence.release();
      }
      throw e;
    }
  }
}
