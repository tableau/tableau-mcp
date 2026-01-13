import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

import { Config } from '../config';
import { RestApiArgs, useRestApi } from '../restApiInstance';
import { getTableauAuthInfo } from '../server/oauth/getTableauAuthInfo';
import { TableauAuthInfo } from '../server/oauth/schemas';
import { CleanupActions } from '../tools/tool';
import { getJwt } from './getJwt';

export async function getWorkgroupSessionId(
  auth: 'oauth' | 'pat',
  config: Config,
  authInfo: AuthInfo | undefined,
  restApiArgs: RestApiArgs,
  cleanupActions: CleanupActions,
): Promise<{ workgroupSessionId: string; domain: string }> {
  switch (auth) {
    case 'oauth': {
      const tableauAuthInfo = getTableauAuthInfo(authInfo);
      return {
        workgroupSessionId: tableauAuthInfo?.accessToken ?? '',
        domain: tableauAuthInfo?.server ?? '',
      };
    }
    case 'pat': {
      const workgroupSessionId = await useRestApi({
        config,
        requestId: restApiArgs.requestId,
        server: restApiArgs.server,
        jwtScopes: [],
        signal: restApiArgs.signal,
        options: { bypassSignOut: true },
        callback: async (restApi) => {
          cleanupActions.push(restApi.signOut);
          return restApi.creds.token;
        },
      });

      const domain = new URL(config.server).hostname;
      return { workgroupSessionId, domain };
    }
  }
}

export async function getEmbeddingJwt({
  config,
  authInfo,
}: {
  config: Config;
  authInfo: AuthInfo | undefined;
}): Promise<string> {
  return await getJwt({
    username: getJwtUsername(config.jwtUsername, getTableauAuthInfo(authInfo)),
    config: {
      type: 'connected-app',
      clientId: config.connectedAppClientId,
      secretId: config.connectedAppSecretId,
      secretValue: config.connectedAppSecretValue,
    },
    scopes: new Set([
      'tableau:views:embed',
      'tableau:views:embed_authoring',
      'tableau:insights:embed',
    ]),
    additionalPayload: getJwtAdditionalPayload(
      config.jwtAdditionalPayload,
      getTableauAuthInfo(authInfo),
    ),
  });
}

export function getJwtUsername(username: string, authInfo: TableauAuthInfo | undefined): string {
  return username.replace('{OAUTH_USERNAME}', authInfo?.username ?? '');
}

export function getJwtAdditionalPayload(
  payload: string,
  authInfo: TableauAuthInfo | undefined,
): Record<string, unknown> {
  payload = payload.replace('{OAUTH_USERNAME}', authInfo?.username ?? '');
  return JSON.parse(payload || '{}');
}
