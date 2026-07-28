import {
  createCallDeadline,
  DEFAULT_DESKTOP_CALL_TIMEOUT_MS,
  DesktopCallTimeoutError,
  desktopCallTimeoutMessage,
  isDesktopCallTimeout,
} from './callDeadline.js';

describe('createCallDeadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to a budget that clears the largest legitimate measured call (37.5s)', () => {
    expect(DEFAULT_DESKTOP_CALL_TIMEOUT_MS).toBeGreaterThan(37_543);
    // ...and stays below the fastest observed hang (212.4s), so it lands inside the empty band.
    expect(DEFAULT_DESKTOP_CALL_TIMEOUT_MS).toBeLessThan(212_388);
  });

  it('aborts its signal and rejects whenExpired once the budget elapses', async () => {
    const deadline = createCallDeadline({ budgetMs: 60_000 });
    const expiry = deadline.whenExpired();

    expect(deadline.signal.aborted).toBe(false);
    expect(deadline.expired()).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.expired()).toBe(true);
    expect(deadline.signal.reason).toBeInstanceOf(DesktopCallTimeoutError);
    await expect(expiry).rejects.toBeInstanceOf(DesktopCallTimeoutError);

    deadline.dispose();
  });

  it('does not cut a legitimate 37.5s call', async () => {
    const deadline = createCallDeadline({ budgetMs: DEFAULT_DESKTOP_CALL_TIMEOUT_MS });

    // The real measured apply-workbook success from the episode logs.
    await vi.advanceTimersByTimeAsync(37_543);

    expect(deadline.signal.aborted).toBe(false);
    expect(deadline.expired()).toBe(false);
    deadline.dispose();
  });

  it('still aborts when the client cancels, and does not call that a timeout', async () => {
    const client = new AbortController();
    const deadline = createCallDeadline({ clientSignal: client.signal, budgetMs: 60_000 });

    client.abort(new Error('client went away'));

    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.expired()).toBe(false);
    expect(isDesktopCallTimeout(deadline.signal.reason)).toBe(false);
    deadline.dispose();
  });

  it('is already aborted when the client signal arrives aborted', () => {
    const client = new AbortController();
    client.abort(new Error('cancelled before dispatch'));

    const deadline = createCallDeadline({ clientSignal: client.signal, budgetMs: 60_000 });

    expect(deadline.signal.aborted).toBe(true);
    deadline.dispose();
  });

  it('stops the clock on dispose so a finished call cannot fire later', async () => {
    const deadline = createCallDeadline({ budgetMs: 60_000 });
    deadline.dispose();

    await vi.advanceTimersByTimeAsync(120_000);

    expect(deadline.signal.aborted).toBe(false);
    expect(deadline.expired()).toBe(false);
  });

  it('leaves no unhandled rejection when the deadline expires unwatched', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const deadline = createCallDeadline({ budgetMs: 1_000 });
      await vi.advanceTimersByTimeAsync(1_000);
      deadline.dispose();

      vi.useRealTimers();
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

describe('desktopCallTimeoutMessage', () => {
  it('names the budget, the likely cause, and forbids a blind retry', () => {
    const message = desktopCallTimeoutMessage({
      budgetMs: 60_000,
      tool: 'apply-workbook',
      session: '31875',
    });

    expect(message).toContain('did not respond within 60s');
    expect(message).toContain('tool: apply-workbook, session: 31875');
    expect(message).toContain('blocking dialog');
    expect(message).toContain('Do not retry this call');
    expect(message).toContain('list-instances');
  });
});
