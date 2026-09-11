/**
 * Per-call deadline for Tableau Desktop tool calls.
 *
 * Every desktop tool call gets one clock. The clock starts when the MCP request handler
 * mints the tool's `extra` and stops when the tool returns. It composes with the client's
 * cancellation signal rather than replacing it: a client cancel still aborts, and a client
 * signal never removes the clock.
 *
 * Budget rationale (309 episode logs, 1,174 timed tool calls): the four slowest legitimate
 * calls are 37.5s, 28.1s, 21.5s and 12.5s, and the three hung calls are 212.4s, 265.2s and
 * 308.1s. Nothing at all falls between 37,543 ms and 212,388 ms, so any ceiling inside that
 * band cuts every hang and no real work. 60s sits in the band with 1.6x headroom over the
 * largest legitimate call.
 */

/** Ceiling for one desktop tool call. See the band argument above. */
export const DEFAULT_DESKTOP_CALL_TIMEOUT_MS = 60_000;

/** Floor for the env override — below the observed 37.5s legitimate max, real work gets cut. */
export const MIN_DESKTOP_CALL_TIMEOUT_MS = 40_000;

export class DesktopCallTimeoutError extends Error {
  readonly budgetMs: number;

  constructor(budgetMs: number) {
    super(`Tableau Desktop did not respond within ${formatBudget(budgetMs)}.`);
    this.name = 'DesktopCallTimeoutError';
    this.budgetMs = budgetMs;
  }
}

export function isDesktopCallTimeout(error: unknown): error is DesktopCallTimeoutError {
  return error instanceof DesktopCallTimeoutError;
}

export function formatBudget(budgetMs: number): string {
  return budgetMs % 1000 === 0 ? `${budgetMs / 1000}s` : `${budgetMs}ms`;
}

export const BLOCKING_DIALOG_GUIDANCE =
  'Desktop may be showing a blocking dialog, or the instance may be wedged. Do not blindly ' +
  'retry the originating operation. Call get-active-dialogs for fresh state. Only when the task ' +
  'or user intent makes the choice unambiguous, copy the exact returned dialog identity and exact ' +
  'returned action into at most one invoke-dialog-action call. Do not guess or assume Cancel is ' +
  'safe, and do not retry invoke-dialog-action after action-invoked-dialog-remains. If inspection times ' +
  'out, either dialog tool is unavailable or version-gated, the identity or intent is ambiguous, ' +
  'or no action is clearly safe, ask the user to handle the dialog. After the dialog is handled, ' +
  'correct its cause before retrying the originating operation, then call list-instances to confirm ' +
  'the session is still reachable and re-target if the pid changed.';

const GET_ACTIVE_DIALOGS_TIMEOUT_GUIDANCE =
  'The dialog inspection itself timed out. Do not retry get-active-dialogs, and do not call ' +
  'invoke-dialog-action without a fresh exact result. Ask the user to inspect and handle any open ' +
  'Tableau dialog, then call list-instances to confirm the session is still reachable.';

export const INVOKE_DIALOG_ACTION_INDETERMINATE_GUIDANCE =
  'The invoke-dialog-action outcome is indeterminate: the action may already have been invoked even ' +
  'though no valid response confirmed the outcome. Do not call invoke-dialog-action again or click ' +
  'another action. You may call get-active-dialogs once for fresh inspection only; its result does ' +
  'not prove that the first click did not happen. Ask the user to handle any consequential choice. ' +
  'If inspection also times out or is unavailable, leave the dialog to the user. Do not retry the ' +
  'originating operation until the dialog is handled and its cause is corrected.';

/**
 * The agent-facing text for an expired call. Ordinary calls get exact inspect/act recovery;
 * dialog-tool timeouts fail more conservatively because inspection cannot safely retry itself
 * and a timed-out dialog action may already have clicked its button.
 */
export function desktopCallTimeoutMessage({
  budgetMs,
  tool,
  session,
}: {
  budgetMs: number;
  tool?: string;
  session?: string;
}): string {
  const scope = [tool ? `tool: ${tool}` : undefined, session ? `session: ${session}` : undefined]
    .filter(Boolean)
    .join(', ');
  const guidance =
    tool === 'invoke-dialog-action'
      ? INVOKE_DIALOG_ACTION_INDETERMINATE_GUIDANCE
      : tool === 'get-active-dialogs'
        ? GET_ACTIVE_DIALOGS_TIMEOUT_GUIDANCE
        : BLOCKING_DIALOG_GUIDANCE;

  return [
    `Tableau Desktop did not respond within ${formatBudget(budgetMs)} and the call was aborted${
      scope ? ` (${scope})` : ''
    }.`,
    guidance,
  ].join(' ');
}

export type CallDeadline = {
  /** The client signal composed with the clock. Aborts on client cancel OR on expiry. */
  readonly signal: AbortSignal;
  /** The budget this deadline enforces, in ms. */
  readonly budgetMs: number;
  /** True once the clock — not the client — aborted the call. */
  expired: () => boolean;
  /**
   * Rejects with {@link DesktopCallTimeoutError} when the clock expires, and never settles
   * otherwise. Safe to leave un-raced: a rejection handler is attached at creation.
   */
  whenExpired: () => Promise<never>;
  /** Clears the timer and detaches the client listener. Always call this when the tool returns. */
  dispose: () => void;
};

export function createCallDeadline({
  clientSignal,
  budgetMs = DEFAULT_DESKTOP_CALL_TIMEOUT_MS,
}: {
  clientSignal?: AbortSignal;
  budgetMs?: number;
}): CallDeadline {
  const controller = new AbortController();
  let timedOut = false;
  let rejectExpiry: (error: unknown) => void = () => undefined;

  const expiry = new Promise<never>((_resolve, reject) => {
    rejectExpiry = reject;
  });
  // A deadline nobody races must not surface as an unhandled rejection.
  expiry.catch(() => undefined);

  const timer = setTimeout(() => {
    timedOut = true;
    const error = new DesktopCallTimeoutError(budgetMs);
    controller.abort(error);
    rejectExpiry(error);
  }, budgetMs);
  timer.unref?.();

  const onClientAbort = (): void => {
    controller.abort(clientSignal?.reason);
  };

  if (clientSignal) {
    if (clientSignal.aborted) {
      controller.abort(clientSignal.reason);
    } else {
      clientSignal.addEventListener('abort', onClientAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    budgetMs,
    expired: () => timedOut,
    whenExpired: () => expiry,
    dispose: () => {
      clearTimeout(timer);
      clientSignal?.removeEventListener('abort', onClientAbort);
    },
  };
}
