import { Result } from 'ts-results-es';

import { WithExecutorAndAbortSignal } from '../../toolExecutor/toolExecutor.js';

// A command settles asynchronously after the apply reports terminal, so a readback taken
// immediately can re-read PRE-apply state and mis-report a durable apply as dropped. Poll instead
// of reading once; 250ms is the interval documented to clear this race for this command class.
export const READBACK_POLL_MAX_ATTEMPTS = 8;
export const READBACK_POLL_INTERVAL_MS = 250;

// Global-timer, not `timers/promises` — vitest fake timers do not fake the latter, so tests that
// advance the clock over this sleep would otherwise wait for real.
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason as Error);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason as Error);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Re-reads until `settled(value)` holds, absorbing the async settle. When the budget is spent
 * without settling it returns the last read as `{settled: false}` rather than erroring — the caller
 * decides whether an unsettled readback is a durable miss (some treat it as failure, some retry).
 */
export async function pollReadback<T, E>({
  read,
  settled,
  signal,
}: {
  read: () => Promise<Result<T, E>>;
  settled: (value: T) => boolean;
  signal: WithExecutorAndAbortSignal['signal'];
}): Promise<{ ok: true; value: T; settled: boolean } | { ok: false; error: E }> {
  let last: T | undefined;
  for (let attempt = 1; attempt <= READBACK_POLL_MAX_ATTEMPTS; attempt++) {
    const result = await read();
    if (result.isErr()) {
      return { ok: false, error: result.error };
    }
    last = result.value;
    if (settled(result.value)) {
      return { ok: true, value: result.value, settled: true };
    }
    if (attempt < READBACK_POLL_MAX_ATTEMPTS) {
      await sleep(READBACK_POLL_INTERVAL_MS, signal);
    }
  }
  return { ok: true, value: last as T, settled: false };
}
