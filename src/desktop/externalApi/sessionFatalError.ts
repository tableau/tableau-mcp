import type { ExecuteCommandResponseError } from './executorTypes.js';

export const SESSION_FATAL_GUIDANCE =
  'Tableau Desktop reported session-fatal error E71AE512. ' +
  'Stop all commands to this Desktop session, including reads. ' +
  'Do not retry the operation or attempt to repair the workbook in this session. ' +
  'Ask the user to restart Tableau Desktop and reopen the workbook. ' +
  'After the restart, call list-instances and use the new session before continuing.';

export function isSessionFatalError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('type' in error) {
    if (error.type === 'desktop-session-fatal') return true;
    if (error.type === 'command-failed' || error.type === 'execute-command-error') {
      return 'error' in error && isSessionFatalError(error.error);
    }
  }
  const tableauErrorCode = 'tableau-error-code' in error ? error['tableau-error-code'] : undefined;
  const code =
    typeof tableauErrorCode === 'string' && tableauErrorCode.length > 0
      ? tableauErrorCode
      : 'code' in error
        ? error.code
        : undefined;
  return typeof code === 'string' && /^(?:0x)?E71AE512$/i.test(code.trim());
}

export function classifySessionFatalError(
  error: NonNullable<ExecuteCommandResponseError>,
): NonNullable<ExecuteCommandResponseError> {
  if (!isSessionFatalError(error)) return error;
  return {
    ...error,
    recoverable: false,
    message: error.message.startsWith(SESSION_FATAL_GUIDANCE)
      ? error.message
      : `${SESSION_FATAL_GUIDANCE}\n${error.message}`,
  };
}
