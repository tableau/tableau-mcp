import dotenv from 'dotenv';

import { AuthConfig } from './sdks/tableau/authConfig.js';
import invariant from './utils/invariant.js';

class Config {
  server: string;
  datasourceLuid: string;
  authConfig: AuthConfig;
  defaultLogLevel: string;
  disableLogMasking: boolean;

  constructor() {
    dotenv.config();

    let { SITE_NAME: siteName } = process.env;
    const {
      SERVER: server,
      DATASOURCE_LUID: datasourceLuid,
      PAT_NAME: patName,
      PAT_VALUE: patValue,
      JWT: jwt,
      USERNAME: username,
      PASSWORD: password,
      CONNECTED_APP_CLIENT_ID: clientId,
      CONNECTED_APP_SECRET_ID: secretId,
      CONNECTED_APP_SECRET_VALUE: secretValue,
      JWT_SCOPES: scopes,
      AUTH_TYPE: authType,
      DEFAULT_LOG_LEVEL: defaultLogLevel,
      DISABLE_LOG_MASKING: disableLogMasking,
    } = process.env;

    siteName = siteName ?? '';
    this.defaultLogLevel = defaultLogLevel ?? 'debug';
    this.disableLogMasking = disableLogMasking === 'true';

    invariant(server, 'The environment variable SERVER is not set');
    invariant(datasourceLuid, 'The environment variable DATASOURCE_LUID is not set');

    this.server = server;
    this.datasourceLuid = datasourceLuid;

    if (patName && patValue && (!authType || authType === 'pat')) {
      this.authConfig = {
        type: 'pat',
        patName,
        patValue,
        siteName,
      };

      return;
    }

    if (jwt && (!authType || authType === 'jwt')) {
      this.authConfig = {
        type: 'jwt',
        jwt,
        siteName,
      };

      return;
    }

    if (
      username &&
      clientId &&
      secretId &&
      secretValue &&
      (!authType || authType === 'direct-trust')
    ) {
      this.authConfig = {
        type: 'direct-trust',
        username,
        clientId,
        secretId,
        secretValue,
        siteName,
        scopes: [
          ...new Set([
            'tableau:viz_data_service:read',
            'tableau:content:read',
            ...(scopes?.split(',') ?? []),
          ]),
        ],
      };

      return;
    }

    if (username && password && (!authType || authType === 'username-password')) {
      this.authConfig = {
        type: 'username-password',
        username,
        password,
        siteName,
      };

      return;
    }

    throw new Error(
      'No authentication method could be determined. Ensure the environment variables are set.',
    );
  }
}

let config: Config;
export const getConfig = (): Config => {
  if (!config) {
    config = new Config();
  }

  return config;
};

export const exportedForTesting = {
  Config,
};
