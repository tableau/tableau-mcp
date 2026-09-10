import { DesktopCommandExecutionError, ImageExportTimeoutError } from './mcpToolError.js';

describe('DesktopCommandExecutionError', () => {
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
    expect(error.message).toContain('action-invoked-dialog-remains');
    expect(error.message).toContain('ask the user to handle the dialog');
  });
});
