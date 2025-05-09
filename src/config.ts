import { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';

import { isLoggingLevel } from './logging/log.js';
import { AuthConfig } from './sdks/tableau/authConfig.js';

class Config {
  server: string;
  datasourceLuid: string;
  authConfig: AuthConfig;
  defaultLogLevel: LoggingLevel;
  disableLogMasking: boolean;

  constructor() {
    dotenv.config();

    const {
      SERVER: server,
      DATASOURCE_LUID: datasourceLuid,
      SITE_NAME: siteName,
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

    this.defaultLogLevel = isLoggingLevel(defaultLogLevel) ? defaultLogLevel : 'debug';
    this.disableLogMasking = disableLogMasking === 'true';

    const required = { server, datasourceLuid };
    for (const [key, value] of Object.entries(required)) {
      if (!value) {
        throw new Error(`The environment variable ${key} is not set.`);
      }
    }

    this.server = server;
    this.datasourceLuid = datasourceLuid;

    if (!siteName) {
      throw new Error(`The environment variable SITE_NAME is not set.`);
    }

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

export const config = new Config();
