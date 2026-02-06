/**
 * Extracts the site LUID from a Tableau access token.
 * The access token format is: part0|part1|siteLuid|...
 *
 * @param accessToken - The Tableau access token
 * @returns The site LUID, or empty string if it cannot be extracted
 */
export function getSiteLuidFromAccessToken(accessToken: string | undefined): string {
  if (!accessToken) {
    return '';
  }

  const parts = accessToken.split('|');
  if (parts.length < 3) {
    return '';
  }

  return parts[2];
}
