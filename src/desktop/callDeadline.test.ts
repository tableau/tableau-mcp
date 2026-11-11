import {
  createCallDeadline,
  DEFAULT_DESKTOP_CALL_TIMEOUT_MS,
  DesktopCallTimeoutError,
  desktopCallTimeoutMessage,
  DIALOG_ACTION_REPLAY_GUIDANCE,
  DIALOG_REQUEST_TRACKING_GUIDANCE,
  INVOKE_DIALOG_ACTION_INDETERMINATE_GUIDANCE,
  INVOKE_DIALOG_ACTION_REPLAY_GUIDANCE,
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

  it('clamps an oversized budget so it does not fire after 1 ms', async () => {
    const deadline = createCallDeadline({ budgetMs: 99_999_999_999 });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(deadline.expired()).toBe(false);
    deadline.dispose();
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
  it('gives an ordinary timeout one exact dialog action with conservative fallback', () => {
    const message = desktopCallTimeoutMessage({
      budgetMs: 60_000,
      tool: 'apply-workbook',
      session: '31875',
    });

    expect(message).toContain('did not respond within 60s');
    expect(message).toContain('tool: apply-workbook, session: 31875');
    expect(message).toContain('blocking dialog');
    expect(message).toContain('Do not blindly retry the originating operation');
    expect(message).toContain('get-active-dialogs');
    expect(message).toContain('exact returned dialog identity');
    expect(message).toContain('advertised action');
    expect(message).toContain('invoke-dialog-action for one logical action');
    expect(message).toContain(DIALOG_REQUEST_TRACKING_GUIDANCE);
    expect(message).toContain('Do not guess or assume Cancel is safe');
    expect(message).toContain('pending or indeterminate status');
    expect(message).toContain('ask the user to handle the dialog');
    expect(message).toContain('list-instances');
  });

  it('does not retry dialog inspection when get-active-dialogs times out', () => {
    const message = desktopCallTimeoutMessage({
      budgetMs: 60_000,
      tool: 'get-active-dialogs',
      session: '31875',
    });

    expect(message).toContain('dialog inspection itself timed out');
    expect(message).toContain('Do not retry get-active-dialogs');
    expect(message).toContain('do not call invoke-dialog-action without a fresh exact result');
    expect(message).toContain('Ask the user to inspect and handle');
    expect(message).not.toContain('at most one invoke-dialog-action call');
  });

  it('permits only identical-request recovery after an invoke-dialog-action timeout', () => {
    const message = desktopCallTimeoutMessage({
      budgetMs: 60_000,
      tool: 'invoke-dialog-action',
      session: '31875',
    });

    expect(message).toContain('invoke-dialog-action outcome is indeterminate');
    expect(message).toContain('action may already have been invoked');
    expect(message).toContain(DIALOG_REQUEST_TRACKING_GUIDANCE);
    expect(message).toContain('original sessionId/requestId');
    expect(message).toContain('replay only the identical request with the same requestId');
    expect(message).toContain('Never use a new requestId');
    expect(message).toContain('restart or session change');
    expect(message).toContain('ask the user to handle any consequential choice');
    expect(message).toContain('tracking is unavailable, expired, or still uncertain');
    expect(message).not.toContain('Do not call invoke-dialog-action again');
    expect(message).not.toContain('at most one invoke-dialog-action call');
    expect(message).toContain(INVOKE_DIALOG_ACTION_INDETERMINATE_GUIDANCE);
  });

  it('keeps fatal-session recovery free of inspection and replacement-session replay', () => {
    expect(INVOKE_DIALOG_ACTION_REPLAY_GUIDANCE).toContain(
      'This failed session must not receive more commands or reads',
    );
    expect(INVOKE_DIALOG_ACTION_REPLAY_GUIDANCE).toContain(DIALOG_ACTION_REPLAY_GUIDANCE);
    expect(INVOKE_DIALOG_ACTION_REPLAY_GUIDANCE).toContain(
      'If the original Desktop session is still usable',
    );
    expect(INVOKE_DIALOG_ACTION_REPLAY_GUIDANCE).toContain(
      'Never use a new requestId for an uncertain outcome or replay across a Desktop restart or session change',
    );
    expect(INVOKE_DIALOG_ACTION_REPLAY_GUIDANCE).not.toContain('get-active-dialogs');
  });
});
