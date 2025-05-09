export interface ProcessEnvEx {
  SERVER: string;
  DATASOURCE_LUID: string;
  USERNAME: string | undefined;
  PASSWORD: string | undefined;
  SITE_NAME: string | undefined;
  PAT_NAME: string | undefined;
  PAT_VALUE: string | undefined;
  JWT: string | undefined;
  CONNECTED_APP_CLIENT_ID: string | undefined;
  CONNECTED_APP_SECRET_ID: string | undefined;
  CONNECTED_APP_SECRET_VALUE: string | undefined;
  JWT_SCOPES: string | undefined;
  AUTH_TYPE: string | undefined;
  DEFAULT_LOG_LEVEL: string | undefined;
  DISABLE_LOG_MASKING: string | undefined;
}

declare global {
  namespace NodeJS {
    interface ProcessEnv extends ProcessEnvEx {
      [key: string]: string | undefined;
    }
  }
}
