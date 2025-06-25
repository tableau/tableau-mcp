export interface ProcessEnvEx {
  TRANSPORT: string | undefined;
  SSL_KEY: string | undefined;
  SSL_CERT: string | undefined;
  PORT: string | undefined;
  SERVER: string | undefined;
  PAT_NAME: string | undefined;
  PAT_VALUE: string | undefined;
  DATASOURCE_CREDENTIALS: string | undefined;
  DEFAULT_LOG_LEVEL: string | undefined;
  DISABLE_LOG_MASKING: string | undefined;
  INCLUDE_TOOLS: string | undefined;
  EXCLUDE_TOOLS: string | undefined;
}

declare global {
  namespace NodeJS {
    interface ProcessEnv extends ProcessEnvEx {
      [key: string]: string | undefined;
    }
  }
}
