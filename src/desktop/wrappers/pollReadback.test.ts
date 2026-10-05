import { Err, Ok, Result } from 'ts-results-es';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  pollReadback,
  READBACK_POLL_INTERVAL_MS,
  READBACK_POLL_MAX_ATTEMPTS,
} from './pollReadback.js';

const signal = new AbortController().signal;

describe('pollReadback', () => {
  afterEach(() => vi.useRealTimers());

  it('returns settled on the first read when the predicate already holds (no sleep)', async () => {
    const read = vi.fn(async (): Promise<Result<string, string>> => Ok('applied'));
    const result = await pollReadback({ read, settled: () => true, signal });

    expect(result).toEqual({ ok: true, value: 'applied', settled: true });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('retries past unsettled reads and returns settled once the change appears', async () => {
    vi.useFakeTimers();
    const reads = ['stale', 'stale', 'applied'];
    let i = 0;
    const read = vi.fn(async (): Promise<Result<string, string>> => Ok(reads[i++] ?? 'applied'));

    const promise = pollReadback({ read, settled: (v) => v === 'applied', signal });
    await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS * READBACK_POLL_MAX_ATTEMPTS);
    const result = await promise;

    expect(result).toEqual({ ok: true, value: 'applied', settled: true });
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('returns the last read as settled:false when the budget is exhausted', async () => {
    vi.useFakeTimers();
    const read = vi.fn(async (): Promise<Result<string, string>> => Ok('stale'));

    const promise = pollReadback({ read, settled: () => false, signal });
    await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS * READBACK_POLL_MAX_ATTEMPTS);
    const result = await promise;

    expect(result).toEqual({ ok: true, value: 'stale', settled: false });
    expect(read).toHaveBeenCalledTimes(READBACK_POLL_MAX_ATTEMPTS);
  });

  it('stops and surfaces the error when a read fails', async () => {
    const read = vi.fn(async (): Promise<Result<string, string>> => Err('read blew up'));
    const result = await pollReadback({ read, settled: () => true, signal });

    expect(result).toEqual({ ok: false, error: 'read blew up' });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('rejects when the abort signal fires between polls', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const read = vi.fn(async (): Promise<Result<string, string>> => Ok('stale'));

    const promise = pollReadback({ read, settled: () => false, signal: controller.signal });
    const rejection = expect(promise).rejects.toBeDefined();
    controller.abort(new Error('cancelled'));
    await rejection;
  });
});
