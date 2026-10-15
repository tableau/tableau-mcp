import { Config } from '../../config.js';
import { TableauAuthInfo } from '../../server/oauth/schemas.js';
import { AuthConfig } from './authConfig.js';

function getJwtUsername(config: Config, authInfo: TableauAuthInfo | undefined): string {
  const username = authInfo?.username ?? '';
  return config.jwtUsername.replaceAll('{OAUTH_USERNAME}', () => username);
}

function getJwtAdditionalPayload(
  config: Config,
  authInfo: TableauAuthInfo | undefined,
): Record<string, unknown> {
  // Escape so the username can't alter the JSON; a replacer function keeps `$'` etc. literal.
  const username = JSON.stringify(authInfo?.username ?? '').slice(1, -1);
  const json = config.jwtAdditionalPayload.replaceAll('{OAUTH_USERNAME}', () => username);
  return JSON.parse(json || '{}');
}

/**
 * Builds an AuthConfig from the server Config and optional TableauAuthInfo.
 * Returns null when the auth mode doesn't produce signable AuthConfig
 * (oauth — Bearer tokens are passed through separately).
 */
export function buildAuthConfig({
  config,
  tableauAuthInfo,
  scopes,
}: {
  config: Config;
  tableauAuthInfo: TableauAuthInfo | undefined;
  scopes: Set<string>;
}): AuthConfig | null {
  const username = getJwtUsername(config, tableauAuthInfo);
  const additionalPayload = getJwtAdditionalPayload(config, tableauAuthInfo);

  switch (config.auth) {
    case 'pat':
      return {
        type: 'pat',
        siteName: config.siteName,
        patName: config.patName,
        patValue: config.patValue,
      };

    case 'direct-trust':
      return {
        type: 'direct-trust',
        siteName: config.siteName,
        username,
        clientId: config.connectedAppClientId,
        secretId: config.connectedAppSecretId,
        secretValue: config.connectedAppSecretValue,
        scopes,
        additionalPayload,
      };

    case 'uat':
      return {
        type: 'uat',
        siteName: config.siteName,
        username,
        tenantId: config.uatTenantId,
        issuer: config.uatIssuer,
        usernameClaimName: config.uatUsernameClaimName,
        privateKey: config.uatPrivateKey,
        keyId: config.uatKeyId,
        scopes,
        additionalPayload,
      };

    case 'oauth':
      // oauth has no server-side signing material — Bearer tokens are passed
      // through separately by the caller.
      return null;
  }
}
