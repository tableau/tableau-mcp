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

/**
 * The agent-facing text for an expired call. It names the budget, says what is most likely
 * wrong, and forbids a blind retry — retrying a call that raised a blocking Desktop dialog
 * just hangs against the same dialog.
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

  return [
    `Tableau Desktop did not respond within ${formatBudget(budgetMs)} and the call was aborted${
      scope ? ` (${scope})` : ''
    }.`,
    'Desktop is most likely showing a blocking dialog that a person has to dismiss, or the instance is wedged.',
    'Do not retry this call — it will hang against the same dialog.',
    'Tell the user to dismiss any open Tableau dialog, then call list-instances to confirm the session is still reachable and re-target if the pid changed.',
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
