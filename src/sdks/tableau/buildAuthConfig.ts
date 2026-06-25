import { Config } from '../../config.js';
import { TableauAuthInfo } from '../../server/oauth/schemas.js';
import { AuthConfig } from './authConfig.js';

/**
 * Builds an AuthConfig from the server Config and optional TableauAuthInfo.
 * Returns undefined when the auth mode doesn't produce signable AuthConfig
 * (e.g., oauth without signing material — Bearer tokens are passed through separately).
 */
export function buildAuthConfig({
  config,
  tableauAuthInfo,
  scopes,
}: {
  config: Config;
  tableauAuthInfo: TableauAuthInfo | undefined;
  scopes: Set<string>;
}): AuthConfig | undefined {
  const username = config.jwtUsername.replaceAll(
    '{OAUTH_USERNAME}',
    tableauAuthInfo?.username ?? '',
  );
  const additionalPayloadJson = config.jwtAdditionalPayload.replaceAll(
    '{OAUTH_USERNAME}',
    tableauAuthInfo?.username ?? '',
  );
  const additionalPayload: Record<string, unknown> = JSON.parse(additionalPayloadJson || '{}');

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
      // OAuth doesn't produce an AuthConfig — Bearer tokens are passed through
      // or credentials are set directly from tableauAuthInfo
      return undefined;
  }
}
