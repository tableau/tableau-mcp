export interface ProcessEnvEx {
  AUTH: string | undefined;
  TRANSPORT: string | undefined;
  SSL_KEY: string | undefined;
  SSL_CERT: string | undefined;
  HTTP_PORT_ENV_VAR_NAME: string | undefined;
  CORS_ORIGIN_CONFIG: string | undefined;
  TRUST_PROXY_CONFIG: string | undefined;
  SERVER: string | undefined;
  SITE_NAME: string | undefined;
  PAT_NAME: string | undefined;
  PAT_VALUE: string | undefined;
  JWT_SUB_CLAIM: string | undefined;
  CONNECTED_APP_CLIENT_ID: string | undefined;
  CONNECTED_APP_SECRET_ID: string | undefined;
  CONNECTED_APP_SECRET_VALUE: string | undefined;
  UAT_TENANT_ID: string | undefined;
  UAT_ISSUER: string | undefined;
  UAT_USERNAME_CLAIM: string | undefined;
  UAT_USERNAME_CLAIM_NAME: string | undefined;
  UAT_PRIVATE_KEY: string | undefined;
  UAT_PRIVATE_KEY_PATH: string | undefined;
  UAT_KEY_ID: string | undefined;
  JWT_ADDITIONAL_PAYLOAD: string | undefined;
  DATASOURCE_CREDENTIALS: string | undefined;
  DEFAULT_LOG_LEVEL: string | undefined;
  DISABLE_LOG_MASKING: string | undefined;
  INCLUDE_TOOLS: string | undefined;
  EXCLUDE_TOOLS: string | undefined;
  MAX_REQUEST_TIMEOUT_MS: string | undefined;
  CODE_MODE_MAX_EXECUTION_TIME_MS: string | undefined;
  CODE_MODE_MAX_OUTPUT_BYTES: string | undefined;
  CODE_MODE_MAX_API_CALLS: string | undefined;
  CODE_MODE_SANDBOX_MEMORY_MB: string | undefined;
  MAX_RESULT_LIMIT: string | undefined;
  MAX_RESULT_LIMITS: string | undefined;
  DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS: string | undefined;
  DISABLE_METADATA_API_REQUESTS: string | undefined;
  DISABLE_SESSION_MANAGEMENT: string | undefined;
  ENABLE_SERVER_LOGGING: string | undefined;
  SERVER_LOG_DIRECTORY: string | undefined;
  INCLUDE_PROJECT_IDS: string | undefined;
  INCLUDE_DATASOURCE_IDS: string | undefined;
  INCLUDE_WORKBOOK_IDS: string | undefined;
  INCLUDE_TAGS: string | undefined;
  TABLEAU_SERVER_VERSION_CHECK_INTERVAL_IN_HOURS: string | undefined;
  MCP_SITE_SETTINGS_CHECK_INTERVAL_IN_MINUTES: string | undefined;
  ENABLE_MCP_SITE_SETTINGS: string | undefined;
  DANGEROUSLY_DISABLE_OAUTH: string | undefined;
  OAUTH_ISSUER: string | undefined;
  OAUTH_JWE_PRIVATE_KEY: string | undefined;
  OAUTH_JWE_PRIVATE_KEY_PATH: string | undefined;
  OAUTH_JWE_PRIVATE_KEY_PASSPHRASE: string | undefined;
  OAUTH_CIMD_DNS_SERVERS: string | undefined;
  OAUTH_REDIRECT_URI: string | undefined;
  OAUTH_LOCK_SITE: string | undefined;
  OAUTH_CLIENT_ID_SECRET_PAIRS: string | undefined;
  OAUTH_AUTHORIZATION_CODE_TIMEOUT_MS: string | undefined;
  OAUTH_ACCESS_TOKEN_TIMEOUT_MS: string | undefined;
  OAUTH_REFRESH_TOKEN_TIMEOUT_MS: string | undefined;
  PRODUCT_TELEMETRY_ENABLED: string | undefined;
  PRODUCT_TELEMETRY_ENDPOINT: string | undefined;
  IS_HYPERFORCE: string | undefined;
}

declare global {
  namespace NodeJS {
    interface ProcessEnv extends ProcessEnvEx {
      [key: string]: string | undefined;
    }
  }
}
