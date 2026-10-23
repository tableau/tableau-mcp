import { classifySessionFatalError, isSessionFatalError } from './sessionFatalError.js';

describe('session-fatal error classification', () => {
  it('recognizes executor, wrapper, and already classified tool errors', () => {
    const error = { code: 'E71AE512', message: 'Internal Error', recoverable: false };
    expect(isSessionFatalError({ type: 'command-failed', error })).toBe(true);
    expect(
      isSessionFatalError({
        type: 'execute-command-error',
        error: { type: 'command-failed', error },
      }),
    ).toBe(true);
    expect(isSessionFatalError({ type: 'desktop-session-fatal' })).toBe(true);
    expect(isSessionFatalError(new Error('E71AE512'))).toBe(false);
    expect(isSessionFatalError({ type: 'unknown', error })).toBe(false);
  });
  it.each(['E71AE512', '0xE71AE512', 'e71ae512', ' 0xe71ae512 '])(
    'recognizes the exact structured Tableau code %s',
    (code) => {
      const original = { code, message: 'Internal Error', recoverable: true };

      const classified = classifySessionFatalError(original);

      expect(classified).toMatchObject({ code, recoverable: false });
      expect(classified.message).toContain('Internal Error');
      expect(classified.message).toContain('restart Tableau Desktop');
      expect(original).toEqual({ code, message: 'Internal Error', recoverable: true });
    },
  );

  it.each(['7A1775A4', 'E71AE5120', 'prefix-E71AE512', 'E71AE512-suffix', ''])(
    'does not mark unrelated or partial code %s as session-fatal',
    (code) => {
      const error = { code, message: 'Internal Error E71AE512', recoverable: false };
      expect(classifySessionFatalError(error)).toBe(error);
    },
  );

  it('uses the underlying Tableau code before the generic transport code', () => {
    expect(
      isSessionFatalError({
        code: 'operation-failed',
        message: 'Internal Error',
        recoverable: false,
        'tableau-error-code': 'E71AE512',
      }),
    ).toBe(true);
    expect(
      isSessionFatalError({
        code: 'E71AE512',
        message: 'Internal Error',
        recoverable: false,
        'tableau-error-code': '7A1775A4',
      }),
    ).toBe(false);
  });

  it('does not duplicate recovery guidance as an error crosses layers', () => {
    const classified = classifySessionFatalError({
      code: 'E71AE512',
      message: 'Internal Error',
      recoverable: false,
    });
    expect(classifySessionFatalError(classified)).toEqual(classified);
    expect(isSessionFatalError(undefined)).toBe(false);
  });

  it('keeps restart guidance visible before a long native diagnostic', () => {
    const diagnostic = 'Internal error details. '.repeat(100);
    const classified = classifySessionFatalError({
      code: 'E71AE512',
      message: diagnostic,
      recoverable: false,
    });

    expect(classified.message.slice(0, 512)).toContain('restart Tableau Desktop');
    expect(classified.message).toContain(diagnostic);
  });
});
