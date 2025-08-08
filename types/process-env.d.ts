export interface ProcessEnvEx {
  AUTH: string | undefined;
  TRANSPORT: string | undefined;
  SSL_KEY: string | undefined;
  SSL_CERT: string | undefined;
  HTTP_PORT_ENV_VAR_NAME: string | undefined;
  CORS_ORIGIN_CONFIG: string | undefined;
  SERVER: string | undefined;
  SITE_NAME: string | undefined;
  PAT_NAME: string | undefined;
  PAT_VALUE: string | undefined;
  JWT_SUB_CLAIM: string | undefined;
  CONNECTED_APP_CLIENT_ID: string | undefined;
  CONNECTED_APP_SECRET_ID: string | undefined;
  CONNECTED_APP_SECRET_VALUE: string | undefined;
  JWT_ADDITIONAL_PAYLOAD: string | undefined;
  DATASOURCE_CREDENTIALS: string | undefined;
  DEFAULT_LOG_LEVEL: string | undefined;
  DISABLE_LOG_MASKING: string | undefined;
  INCLUDE_TOOLS: string | undefined;
  EXCLUDE_TOOLS: string | undefined;
  MAX_RESULT_LIMIT: string | undefined;
  DISABLE_QUERY_DATASOURCE_FILTER_VALIDATION: string | undefined;
  OAUTH_ISSUER: string | undefined;
  OAUTH_JWT_SECRET: string | undefined;
  OAUTH_REDIRECT_URI: string | undefined;
  OAUTH_AUTHORIZATION_CODE_TIMEOUT_MS: string | undefined;
  OAUTH_ACCESS_TOKEN_TIMEOUT_MS: string | undefined;
  OAUTH_REFRESH_TOKEN_TIMEOUT_MS: string | undefined;
}

declare global {
  namespace NodeJS {
    interface ProcessEnv extends ProcessEnvEx {
      [key: string]: string | undefined;
    }
  }
}
