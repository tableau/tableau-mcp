export function getSiteIdFromAccessToken(accessToken: string): string {
  const parts = accessToken.split('|');
  if (parts.length < 3) {
    throw new Error('Could not determine site ID. Access token must have 3 parts.');
  }

  const siteId = parts[2];
  return siteId;
}
