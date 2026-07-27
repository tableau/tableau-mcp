import { DesktopCommandExecutionError } from './mcpToolError.js';

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
});
