import { RequestId } from '@modelcontextprotocol/sdk/types.js';

import {
  getRequestErrorInterceptor,
  getRequestInterceptor,
  getResponseErrorInterceptor,
  getResponseInterceptor,
} from './apiClients.js';
import { Config } from './config.js';
import { log } from './logging/log.js';
import { RestApi } from './sdks/tableau/restApi.js';
import { Server } from './server.js';
import { TableauAuthInfo } from './server/oauth/schemas.js';
import invariant from './utils/invariant.js';

type JwtScopes =
  | 'tableau:viz_data_service:read'
  | 'tableau:content:read'
  | 'tableau:insight_definitions_metrics:read'
  | 'tableau:insight_metrics:read'
  | 'tableau:metric_subscriptions:read'
  | 'tableau:insights:read'
  | 'tableau:views:download'
  | 'tableau:insight_brief:create';

const getNewRestApiInstanceAsync = async (
  config: Config,
  requestId: RequestId,
  server: Server,
  jwtScopes: Set<JwtScopes>,
  signal: AbortSignal,
  authInfo?: TableauAuthInfo,
): Promise<RestApi> => {
  signal.addEventListener(
    'abort',
    () => {
      log.info(
        server,
        {
          type: 'request-cancelled',
          requestId,
          reason: signal.reason,
        },
        { logger: server.name, requestId },
      );
    },
    { once: true },
  );

  const tableauServer = config.server || authInfo?.server;
  invariant(tableauServer, 'Tableau server could not be determined');

  const restApi = new RestApi(tableauServer, {
    maxRequestTimeoutMs: config.maxRequestTimeoutMs,
    signal,
    requestInterceptor: [
      getRequestInterceptor(server, requestId, 'rest-api'),
      getRequestErrorInterceptor(server, requestId, 'rest-api'),
    ],
    responseInterceptor: [
      getResponseInterceptor(server, requestId, 'rest-api'),
      getResponseErrorInterceptor(server, requestId, 'rest-api'),
    ],
  });

  if (config.auth === 'pat') {
    await restApi.signIn({
      type: 'pat',
      patName: config.patName,
      patValue: config.patValue,
      siteName: config.siteName,
    });
  } else if (config.auth === 'direct-trust') {
    await restApi.signIn({
      type: 'direct-trust',
      siteName: config.siteName,
      username: getJwtUsername(config, authInfo),
      clientId: config.connectedAppClientId,
      secretId: config.connectedAppSecretId,
      secretValue: config.connectedAppSecretValue,
      scopes: jwtScopes,
      additionalPayload: getJwtAdditionalPayload(config, authInfo),
    });
  } else if (config.auth === 'uat') {
    await restApi.signIn({
      type: 'uat',
      siteName: config.siteName,
      username: getJwtUsername(config, authInfo),
      tenantId: config.uatTenantId,
      issuer: config.uatIssuer,
      usernameClaimName: config.uatUsernameClaimName,
      privateKey: config.uatPrivateKey,
      keyId: config.uatKeyId,
      scopes: jwtScopes,
      additionalPayload: getJwtAdditionalPayload(config, authInfo),
    });
  } else {
    if (!authInfo?.accessToken || !authInfo?.userId) {
      throw new Error('Auth info is required when not signing in first.');
    }

    restApi.setCredentials(authInfo.accessToken, authInfo.userId);
  }

  return restApi;
};

export const useRestApi = async <T>({
  config,
  requestId,
  server,
  callback,
  jwtScopes,
  signal,
  authInfo,
}: {
  config: Config;
  requestId: RequestId;
  server: Server;
  jwtScopes: Array<JwtScopes>;
  signal: AbortSignal;
  callback: (restApi: RestApi) => Promise<T>;
  authInfo?: TableauAuthInfo;
}): Promise<T> => {
  const restApi = await getNewRestApiInstanceAsync(
    config,
    requestId,
    server,
    new Set(jwtScopes),
    signal,
    authInfo,
  );
  try {
    return await callback(restApi);
  } finally {
    if (config.auth !== 'oauth') {
      // Tableau REST sessions for 'pat' and 'direct-trust' are intentionally ephemeral.
      // Sessions for 'oauth' are not. Signing out would invalidate the session,
      // preventing the access token from being reused for subsequent requests.
      await restApi.signOut();
    }
  }
};

function getJwtUsername(config: Config, authInfo: TableauAuthInfo | undefined): string {
  return config.jwtUsername.replaceAll('{OAUTH_USERNAME}', authInfo?.username ?? '');
}

function getJwtAdditionalPayload(
  config: Config,
  authInfo: TableauAuthInfo | undefined,
): Record<string, unknown> {
  const json = config.jwtAdditionalPayload.replaceAll('{OAUTH_USERNAME}', authInfo?.username ?? '');
  return JSON.parse(json || '{}');
}
