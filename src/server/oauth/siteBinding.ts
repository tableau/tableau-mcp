import { Config } from '../../config.js';
import { TableauAuthInfo } from './schemas.js';

export type SiteBindingClaims = {
  tableauServer: string;
  tableauSiteContentUrl: string | undefined;
};

// Hostname only: the OAuth callback stores `https://<origin_host>/` and validates just the hostname,
// so scheme/port in SERVER must not cause valid tokens to be rejected.
function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function serversMatch(configServer: string, tokenServer: string): boolean {
  const expected = hostOf(configServer);
  const actual = hostOf(tokenServer);
  return expected !== undefined && actual !== undefined && expected === actual;
}

export function siteMatchesConfig({
  configSiteName,
  siteName,
  siteContentUrl,
}: {
  configSiteName: string;
  siteName?: string;
  siteContentUrl?: string;
}): boolean {
  return (
    siteName === configSiteName ||
    siteContentUrl === configSiteName ||
    (siteName === 'Default' && !configSiteName)
  );
}

// Modes where this server, not the user's Tableau OAuth token, decides which site is accessed.
// A token minted for any other site must never be accepted there, regardless of OAUTH_LOCK_SITE.
export function siteIsServerDetermined(config: Pick<Config, 'auth'>): boolean {
  return config.auth !== 'oauth';
}

export function siteBindingRequired(config: Pick<Config, 'auth' | 'oauth'>): boolean {
  return siteIsServerDetermined(config) || config.oauth.lockSite;
}

export function checkEmbeddedTokenBinding(
  config: Pick<Config, 'auth' | 'oauth' | 'server' | 'siteName'>,
  claims: SiteBindingClaims,
  liveSite?: { name?: string; contentUrl?: string },
): string | undefined {
  if (config.server && !serversMatch(config.server, claims.tableauServer)) {
    return 'Access token was issued for a different Tableau server';
  }

  if (!siteBindingRequired(config)) {
    return;
  }

  // oauth mode resolves the site from the live Tableau session; other modes trust only the claim
  // stamped at mint time. A missing claim fails closed so pre-binding tokens must re-authenticate.
  if (config.auth === 'oauth') {
    if (!liveSite) {
      return 'Access token is not bound to a Tableau site';
    }

    return siteMatchesConfig({
      configSiteName: config.siteName,
      siteName: liveSite.name,
      siteContentUrl: liveSite.contentUrl,
    })
      ? undefined
      : 'Access token was issued for a different Tableau site';
  }

  if (claims.tableauSiteContentUrl === undefined) {
    return 'Access token is not bound to a Tableau site';
  }

  if (claims.tableauSiteContentUrl !== config.siteName) {
    return 'Access token was issued for a different Tableau site';
  }
}

export function assertSignedInSiteMatchesToken({
  signedInSiteId,
  tableauAuthInfo,
}: {
  signedInSiteId: string;
  tableauAuthInfo: TableauAuthInfo | undefined;
}): void {
  if (tableauAuthInfo?.type !== 'X-Tableau-Auth' && tableauAuthInfo?.type !== 'Bearer') {
    return;
  }

  const outerSiteId = tableauAuthInfo.siteId;
  if (outerSiteId && outerSiteId !== signedInSiteId) {
    throw new Error(
      'Site binding violation: the access token was issued for a different Tableau site than the one signed in to.',
    );
  }
}

export function getSessionBinding(authInfo: TableauAuthInfo | undefined): string {
  if (!authInfo) {
    return '';
  }

  return JSON.stringify([
    authInfo.type,
    authInfo.server,
    authInfo.siteId ?? '',
    authInfo.siteName,
    authInfo.username,
    authInfo.userId ?? '',
  ]);
}
