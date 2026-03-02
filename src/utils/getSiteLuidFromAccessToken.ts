import { TableauAuthInfo } from '../server/oauth/schemas';

/**
 * Extracts the site LUID from a Tableau access token.
 * The access token format is: part0|part1|siteLuid|...
 *
 * @param accessTokenOrTableauAuthInfo - An access token string or Tableau authentication info
 * @returns The site LUID, or empty string if it cannot be extracted
 */
export function getSiteLuidFromAccessToken(accessToken: string | undefined): string;
export function getSiteLuidFromAccessToken(tableauAuthInfo: TableauAuthInfo | undefined): string;
export function getSiteLuidFromAccessToken(
  accessTokenOrTableauAuthInfo: string | TableauAuthInfo | undefined,
): string {
  if (!accessTokenOrTableauAuthInfo) {
    return '';
  }

  if (typeof accessTokenOrTableauAuthInfo === 'string') {
    const wgSessionId = accessTokenOrTableauAuthInfo;
    return getSiteLuidFromWgSessionId(wgSessionId);
  }

  const authInfo = accessTokenOrTableauAuthInfo;
  if (authInfo.type === 'X-Tableau-Auth') {
    return getSiteLuidFromWgSessionId(authInfo.accessToken ?? '');
  }

  return authInfo.siteId;
}

function getSiteLuidFromWgSessionId(wgSessionId: string): string {
  const parts = wgSessionId.split('|') ?? [];
  if (parts.length < 3) {
    return '';
  }

  return parts[2];
}
