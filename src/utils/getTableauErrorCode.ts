import { isAxiosError } from './axios.js';

/**
 * Reads the Tableau REST error code (e.g. "403157") from an Axios error. Tableau
 * serializes REST errors as `{ error: { code, summary, detail } }` in the body
 * and also echoes the code in the `tableau_error_code` response header, so we
 * check both. Used to distinguish a feature-flag-off 403 from an ordinary
 * forbidden / insufficient-permission 403.
 */
export function getTableauErrorCode(error: unknown): string | undefined {
  if (!isAxiosError(error)) {
    return undefined;
  }
  const bodyCode = error.response?.data?.error?.code;
  if (typeof bodyCode === 'string' && bodyCode.length > 0) {
    return bodyCode;
  }
  const headerCode = error.response?.headers?.tableau_error_code;
  if (typeof headerCode === 'string' && headerCode.length > 0) {
    return headerCode;
  }
  return undefined;
}
