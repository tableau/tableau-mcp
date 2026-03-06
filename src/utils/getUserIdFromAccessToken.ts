import { TableauAuthInfo } from '../server/oauth/schemas.js';

/**
 * Extracts the user LUID from Tableau authentication info.
 *
 * @param tableauAuthInfo - Tableau authentication info
 * @returns The user LUID, or empty string if it cannot be extracted
 */
export function getUserIdFromAccessToken(
  tableauAuthInfo: TableauAuthInfo | undefined,
): string {
  if (!tableauAuthInfo) {
    return '';
  }

  if (tableauAuthInfo.type === 'X-Tableau-Auth') {
    return tableauAuthInfo.userId ?? '';
  }

  // For Bearer tokens, userId is not available in the token itself
  return '';
}
