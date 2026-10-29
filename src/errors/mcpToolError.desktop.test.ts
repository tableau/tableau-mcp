import {
  DesktopCommandExecutionError,
  getSessionFatalError,
  ImageExportTimeoutError,
  throwIfSessionFatalError,
} from './mcpToolError.desktop.js';

describe('session-fatal propagation', () => {
  it('preserves classified errors and native evidence through wrapper layers', () => {
    const raw = {
      type: 'command-failed',
      error: {
        code: 'operation-failed',
        'tableau-error-code': '0xe71ae512',
        message: 'native diagnostic',
        recoverable: true,
      },
    };
    const fatal = getSessionFatalError({ type: 'execute-command-error', error: raw });
    expect(fatal).toMatchObject({ type: 'desktop-session-fatal' });
    expect(fatal?.message).toContain('native diagnostic');
    expect(fatal?.message).toContain('tableau-error-code: 0xe71ae512');
    expect(getSessionFatalError(fatal)).toBe(fatal);
    expect(() => throwIfSessionFatalError(fatal)).toThrow(fatal);
  });

  it.each([
    undefined,
    null,
    'E71AE512',
    new Error('E71AE512'),
    { code: 'awaiting-user', message: 'E71AE512', recoverable: false },
  ])('leaves ordinary failures on their existing recovery path: %s', (error) => {
    expect(getSessionFatalError(error)).toBeUndefined();
    expect(() => throwIfSessionFatalError(error)).not.toThrow();
  });
});

describe('DesktopCommandExecutionError', () => {
  it.each(['E71AE512', '0xe71ae512'])(
    'prioritizes session-fatal recovery for %s over a command fix',
    (code) => {
      const error = new DesktopCommandExecutionError(
        {
          type: 'command-failed',
          error: { code, message: 'Command tabdoc:apply failed', recoverable: false },
        },
        'Retry with different XML.',
      );

      expect(error.type).toBe('desktop-session-fatal');
      expect(error.message).toContain('Command tabdoc:apply failed');
      expect(error.message).toContain('Stop all commands');
      expect(error.message).toContain('restart Tableau Desktop');
      expect(error.message).not.toContain('Retry with different XML');
      expect(error.message).not.toContain('retry once');
      expect(error.blockedByDesktopDialog).toBe(false);
    },
  );

  it('forbids invented causes for a bare command failure', () => {
    const error = new DesktopCommandExecutionError({
      type: 'command-failed',
      error: {
        code: 'ERROR',
        message: 'Command tabui:load-underlying-metadata failed',
        recoverable: false,
      },
    });

    expect(error.message).toContain('Command tabui:load-underlying-metadata failed');
    expect(error.message).toContain('Do NOT name, guess, or imply a cause');
  });

  it('preserves multi-line cause evidence without bare-failure guidance', () => {
    const error = new DesktopCommandExecutionError({
      type: 'command-failed',
      error: {
        code: 'ERROR',
        message: 'Command tabdoc:apply failed\nAccess denied to workbook',
        recoverable: false,
      },
    });

    expect(error.message).toContain('Access denied to workbook');
    expect(error.message).not.toContain('Do NOT name, guess, or imply a cause');
  });

  it('flags an awaiting-user failure as blocked by a Desktop dialog', () => {
    const error = new DesktopCommandExecutionError({
      type: 'command-failed',
      error: {
        code: 'awaiting-user',
        message: 'The operation is blocked on a Tableau Desktop dialog.',
        recoverable: false,
      },
    });

    expect(error.blockedByDesktopDialog).toBe(true);
  });

  it('flags a timed-out command as blocked by a Desktop dialog', () => {
    const error = new DesktopCommandExecutionError({
      type: 'command-timed-out',
      error: 'Tableau Desktop did not respond within 60s.',
    });

    expect(error.blockedByDesktopDialog).toBe(true);
  });

  it('does not flag an ordinary command failure as blocked by a Desktop dialog', () => {
    const error = new DesktopCommandExecutionError({
      type: 'command-failed',
      error: { code: '8F2A4D91', message: 'Unable to complete action', recoverable: false },
    });

    expect(error.blockedByDesktopDialog).toBe(false);
  });
});

describe('ImageExportTimeoutError', () => {
  it('uses exact one-action dialog recovery with conservative fallback', () => {
    const error = new ImageExportTimeoutError('Worksheet', 60_000);

    expect(error.message).toContain('Worksheet image export exceeded 60s');
    expect(error.message).toContain('Do not blindly retry the originating operation');
    expect(error.message).toContain('get-active-dialogs');
    expect(error.message).toContain('exact returned dialog identity');
    expect(error.message).toContain('exact returned action');
    expect(error.message).toContain('at most one invoke-dialog-action call');
    expect(error.message).toContain('Do not guess or assume Cancel is safe');
    expect(error.message).toContain('dialog-remains effect');
    expect(error.message).toContain('ask the user to handle the dialog');
  });
});
