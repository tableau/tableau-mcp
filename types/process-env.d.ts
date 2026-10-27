interface ProcessEnvBase {
  TRANSPORT: string | undefined;
  DEFAULT_NOTIFICATION_LEVEL: string | undefined;
  LOG_LEVEL: string | undefined;
  ENABLED_LOGGERS: string | undefined;
  FILE_LOGGER_DIRECTORY: string | undefined;
  EPISODE_EVENTS: string | undefined;
  EPISODE_EVENTS_DIR: string | undefined;
  MAX_REQUEST_TIMEOUT_MS: string | undefined;
  DISABLE_LOG_MASKING: string | undefined;
  NOTIFICATION_PAYLOAD_MAX_BYTES: string | undefined;
  PRODUCT_TELEMETRY_ENABLED: string | undefined;
  PRODUCT_TELEMETRY_ENDPOINT: string | undefined;
  IS_HYPERFORCE: string | undefined;
  TOOL_PROFILE: string | undefined;
}

export interface ProcessEnvWeb extends ProcessEnvBase {
  AUTH: string | undefined;
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
  UAT_TENANT_ID: string | undefined;
  UAT_ISSUER: string | undefined;
  UAT_USERNAME_CLAIM: string | undefined;
  UAT_USERNAME_CLAIM_NAME: string | undefined;
  UAT_PRIVATE_KEY: string | undefined;
  UAT_PRIVATE_KEY_PATH: string | undefined;
  UAT_KEY_ID: string | undefined;
  JWT_ADDITIONAL_PAYLOAD: string | undefined;
  DATASOURCE_CREDENTIALS: string | undefined;
  INCLUDE_TOOLS: string | undefined;
  EXCLUDE_TOOLS: string | undefined;
  MAX_RESULT_LIMIT: string | undefined;
  MAX_RESULT_LIMITS: string | undefined;
  DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS: string | undefined;
  DISABLE_METADATA_API_REQUESTS: string | undefined;
  DISABLE_SESSION_MANAGEMENT: string | undefined;
  INCLUDE_PROJECT_IDS: string | undefined;
  INCLUDE_DATASOURCE_IDS: string | undefined;
  INCLUDE_WORKBOOK_IDS: string | undefined;
  INCLUDE_VIEW_IDS: string | undefined;
  INCLUDE_TAGS: string | undefined;
  TABLEAU_SERVER_VERSION_CHECK_INTERVAL_IN_HOURS: string | undefined;
  PASSTHROUGH_AUTH_USER_SESSION_CHECK_INTERVAL_IN_MINUTES: string | undefined;
  MCP_SITE_SETTINGS_CHECK_INTERVAL_IN_MINUTES: string | undefined;
  ENABLE_MCP_SITE_SETTINGS: string | undefined;
  ALLOW_SITES_TO_CONFIGURE_REQUEST_OVERRIDES: string | undefined;
  ALLOWED_REQUEST_OVERRIDES: string | undefined;
  ENABLE_PASSTHROUGH_AUTH: string | undefined;
  DANGEROUSLY_DISABLE_OAUTH: string | undefined;
  OAUTH_EMBEDDED_AUTHZ_SERVER: string | undefined;
  OAUTH_ISSUER: string | undefined;
  OAUTH_JWE_PRIVATE_KEY: string | undefined;
  OAUTH_JWE_PRIVATE_KEY_PATH: string | undefined;
  OAUTH_JWE_PRIVATE_KEY_PASSPHRASE: string | undefined;
  OAUTH_CIMD_DNS_SERVERS: string | undefined;
  ADVERTISE_API_SCOPES: string | undefined;
  OAUTH_REDIRECT_URI: string | undefined;
  OAUTH_RESOURCE_URI: string | undefined;
  OAUTH_GLOBAL_RESOURCE_URIS: string | undefined;
  OAUTH_LOCK_SITE: string | undefined;
  OAUTH_CLIENT_ID_SECRET_PAIRS: string | undefined;
  OAUTH_DISABLE_SCOPES: string | undefined;
  OAUTH_AUTHORIZATION_CODE_TIMEOUT_MS: string | undefined;
  OAUTH_ACCESS_TOKEN_TIMEOUT_MS: string | undefined;
  OAUTH_REFRESH_TOKEN_TIMEOUT_MS: string | undefined;
  LATENCY_METRIC_NAME: string | undefined;
  TELEMETRY_PROVIDER: string | undefined;
  TELEMETRY_PROVIDER_CONFIG: string | undefined;
  BREAK_GLASS_DISABLE_GLOBALLY: string | undefined;
  ADMIN_TOOLS_ENABLED: string | undefined;
  PENDING_DELETION_MAX_AGE_DAYS: string | undefined;
  FLOW_READ_TOOLS_ENABLED: string | undefined;
  FLOW_WRITE_TOOLS_ENABLED: string | undefined;
  INSIGHTS_TOOLS_ENABLED: string | undefined;
  ADMIN_GATE_CACHE_TTL_MINUTES: string | undefined;
  STALE_CONTENT_MIN_AGE_DAYS: string | undefined;
  STALE_CONTENT_MAX_ROWS: string | undefined;
}

export interface ProcessEnvDesktop extends ProcessEnvBase {
  TABLEAU_DESKTOP_SESSION_ID: string | undefined;
  AGENT_TYPES: string | undefined;
  SYSTEM_PROMPT_VERSION: string | undefined;
  LANGSMITH_RUN_ID: string | undefined;
  LANGSMITH_TRACE_ID: string | undefined;
  INLINE_XML_MAX_BYTES: string | undefined;
  INLINE_IMAGE_MAX_BYTES: string | undefined;
  IMAGE_EXPORT_TIMEOUT_MS: string | undefined;
  TABLEAU_DESKTOP_CALL_TIMEOUT_MS: string | undefined;
  TABLEAU_EXTERNAL_API_DISCOVERY_DIR: string | undefined;
  TABLEAU_COMMANDS_REGISTRY_DIR: string | undefined;
  TABLEAU_USER_AGENT_PREFIX: string | undefined;
  TABLEAU_KNOWLEDGE_DIR: string | undefined;
  TEMPLATES_DIR: string | undefined;
  TABLEAU_REPOSITORY_DIR: string | undefined;
  WORKBOOK_XSD_PATH: string | undefined;
  TWB_INDEX_PATH: string | undefined;
  EXAMPLES_DIR: string | undefined;
  ENABLE_FILTER_GUARDRAIL: string | undefined;
  ALLOW_SKIP_VALIDATION: string | undefined;
  TABLEAU_POD_NAME: string | undefined;
  TABLEAU_SITE_LUID: string | undefined;
  TABLEAU_USER_LUID: string | undefined;
  TABLEAU_CHAT_ID: string | undefined;
  TABLEAU_DESKTOP_SESSION_LUID: string | undefined;
  TABLEAU_MCP_CACHE_DIR: string | undefined;
}

declare global {
  namespace NodeJS {
    interface ProcessEnv extends ProcessEnvWeb, ProcessEnvDesktop {
      [key: string]: string | undefined;
    }
  }
}
