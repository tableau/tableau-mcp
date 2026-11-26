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
 *   the error propagates (fail closed — no token is minted, nothing is mutated). On confirm a
 *   missing or malformed token is rejected first, without calling `resolveState()`.
 *
 * Keep the wording here, not at call sites, so every signed-token tool says the same thing:
 * "short-lived token bound to this change" (NOT "single-use" — see signedTokenEvidence.ts for the
 * residual cross-replica replay window).
 */
import { PreviewNotRunError } from '../../../errors/mcpToolError.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { WebToolName } from '../toolName.js';
import { isWellFormedConfirmationToken } from './confirmationTokenCodec.js';
import { EvidenceContext } from './evidence.js';
import { renderPreviewNotRunMessage, renderTokenConfirmNextStep } from './hitlText.js';
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

  private async context(
    { restApi, userLuid }: SignedConfirmationCaller,
    confirmationToken?: string,
  ): Promise<EvidenceContext> {
    const state = this.spec.resolveState ? await this.spec.resolveState() : undefined;
    return {
      restApi,
      siteId: restApi.siteId,
      target: { id: this.spec.targetId, ...(state === undefined ? {} : { state }) },
      tool: this.spec.tool,
      userLuid,
      confirmationToken,
      binding: this.spec.binding,
    };
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
   * Standalone confirm: re-resolve the pre-state and verify the token. Throws PreviewNotRunError
   * (with the state-changed detail when that is why) on any failure; resolves only when the caller
   * may mutate.
   */
  async confirm(
    caller: SignedConfirmationCaller,
    confirmationToken: string | undefined,
  ): Promise<void> {
    // Reject a missing or garbage token BEFORE resolveState(): no REST lookups for a confirm that
    // cannot pass, and the "run the preview first" message is not masked by a lookup error.
    if (
      isWellFormedConfirmationToken(confirmationToken) &&
      (await this.evidence.verify(await this.context(caller, confirmationToken)))
    ) {
      return;
    }
    throw new PreviewNotRunError(
      renderPreviewNotRunMessage({
        tool: this.spec.tool,
        targetKind: this.spec.targetKind,
        targetId: this.spec.targetId,
        detail: isWellFormedConfirmationToken(confirmationToken)
          ? this.evidence.explainRejection()
          : undefined,
      }),
    );
  }
}
