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
    expect(error.message).toContain('Do not name, guess, or imply a cause');
  });
});
