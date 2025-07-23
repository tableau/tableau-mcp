import { CorsOptions } from 'cors';

import { isToolName, ToolName } from './tools/toolName.js';
import { isTransport, TransportName } from './transports.js';
import invariant from './utils/invariant.js';

export class Config {
  auth: 'pat' | 'oauth';
  server: string;
  transport: TransportName;
  sslKey: string;
  sslCert: string;
  httpPort: number;
  corsOriginConfig: CorsOptions['origin'];
  siteName: string;
  patName: string;
  patValue: string;
  datasourceCredentials: string;
  defaultLogLevel: string;
  disableLogMasking: boolean;
  includeTools: Array<ToolName>;
  excludeTools: Array<ToolName>;
  maxResultLimit: number | null;
  oauth: {
    enabled: boolean;
    issuer: string;
    redirectUri: string;
    jwtSecret: string;
    authzCodeTimeoutMs: number;
    refreshTokenTimeoutMs: number;
  };

  constructor() {
    const {
      AUTH: auth,
      SERVER: server,
      SITE_NAME: siteName,
      TRANSPORT: transport,
      SSL_KEY: sslKey,
      SSL_CERT: sslCert,
      HTTP_PORT_ENV_VAR_NAME: httpPortEnvVarName,
      CORS_ORIGIN_CONFIG: corsOriginConfig,
      PAT_NAME: patName,
      PAT_VALUE: patValue,
      DATASOURCE_CREDENTIALS: datasourceCredentials,
      DEFAULT_LOG_LEVEL: defaultLogLevel,
      DISABLE_LOG_MASKING: disableLogMasking,
      OAUTH_ISSUER: oauthIssuer,
      OAUTH_JWT_SECRET: jwtSecret,
      OAUTH_REDIRECT_URI: redirectUri,
      OAUTH_AUTHORIZATION_CODE_TIMEOUT_MS: authzCodeTimeoutMs,
      OAUTH_REFRESH_TOKEN_TIMEOUT_MS: refreshTokenTimeoutMs,
      INCLUDE_TOOLS: includeTools,
      EXCLUDE_TOOLS: excludeTools,
      MAX_RESULT_LIMIT: maxResultLimit,
    } = process.env;

    this.siteName = siteName ?? '';
    this.auth = auth === 'oauth' ? 'oauth' : 'pat';
    this.transport = isTransport(transport) ? transport : 'stdio';
    this.sslKey = sslKey?.trim() ?? '';
    this.sslCert = sslCert?.trim() ?? '';
    this.httpPort = parseNumber(process.env[httpPortEnvVarName?.trim() || 'PORT'], 3927);
    this.corsOriginConfig = getCorsOriginConfig(corsOriginConfig?.trim() ?? '');
    this.datasourceCredentials = datasourceCredentials ?? '';
    this.defaultLogLevel = defaultLogLevel ?? 'debug';
    this.disableLogMasking = disableLogMasking === 'true';
    this.oauth = {
      enabled: !!oauthIssuer,
      issuer: oauthIssuer ?? '',
      redirectUri: redirectUri ?? (oauthIssuer ? `${oauthIssuer}/Callback` : ''),
      jwtSecret: jwtSecret ?? '',
      authzCodeTimeoutMs: parseNumber(authzCodeTimeoutMs, 10 * 60 * 1000), // 10 minutes
      refreshTokenTimeoutMs: parseNumber(refreshTokenTimeoutMs, 30 * 24 * 60 * 60 * 1000), // 30 days
    };

    if (this.oauth.enabled) {
      invariant(this.oauth.issuer, 'The environment variable OAUTH_ISSUER is not set');
      invariant(this.oauth.redirectUri, 'The environment variable OAUTH_REDIRECT_URI is not set');
      invariant(this.oauth.jwtSecret, 'The environment variable OAUTH_JWT_SECRET is not set');
    } else if (this.auth === 'oauth') {
      throw new Error('When auth is "oauth", OAUTH_ISSUER must be set');
    }

    const maxResultLimitNumber = maxResultLimit ? parseInt(maxResultLimit) : NaN;
    this.maxResultLimit =
      isNaN(maxResultLimitNumber) || maxResultLimitNumber <= 0 ? null : maxResultLimitNumber;

    this.includeTools = includeTools
      ? includeTools
          .split(',')
          .map((s) => s.trim())
          .filter(isToolName)
      : [];

    this.excludeTools = excludeTools
      ? excludeTools
          .split(',')
          .map((s) => s.trim())
          .filter(isToolName)
      : [];

    if (this.includeTools.length > 0 && this.excludeTools.length > 0) {
      throw new Error('Cannot specify both INCLUDE_TOOLS and EXCLUDE_TOOLS');
    }

    invariant(server, 'The environment variable SERVER is not set');
    validateServer(server);

    if (this.auth === 'pat') {
      invariant(patName, 'The environment variable PAT_NAME is not set');
      invariant(patValue, 'The environment variable PAT_VALUE is not set');
    }

    this.server = server;
    this.patName = patName ?? '';
    this.patValue = patValue ?? '';
  }
}

function validateServer(server: string): void {
  if (!server.startsWith('https://')) {
    throw new Error(`The environment variable SERVER must start with "https://": ${server}`);
  }

  try {
    const _ = new URL(server);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The environment variable SERVER is not a valid URL: ${server} -- ${errorMessage}`,
    );
  }
}

function getCorsOriginConfig(corsOriginConfig: string): CorsOptions['origin'] {
  if (!corsOriginConfig) {
    return true;
  }

  if (corsOriginConfig.match(/^true|false$/i)) {
    return corsOriginConfig.toLowerCase() === 'true';
  }

  if (corsOriginConfig === '*') {
    return '*';
  }

  if (corsOriginConfig.startsWith('[') && corsOriginConfig.endsWith(']')) {
    try {
      const origins = JSON.parse(corsOriginConfig) as Array<string>;
      return origins.map((origin) => new URL(origin).origin);
    } catch {
      throw new Error(
        `The environment variable CORS_ORIGIN_CONFIG is not a valid array of URLs: ${corsOriginConfig}`,
      );
    }
  }

  try {
    return new URL(corsOriginConfig).origin;
  } catch {
    throw new Error(
      `The environment variable CORS_ORIGIN_CONFIG is not a valid URL: ${corsOriginConfig}`,
    );
  }
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }

  const number = parseInt(value, 10);
  return isNaN(number) || number < 0 ? defaultValue : number;
}

export const getConfig = (): Config => new Config();

export const exportedForTesting = {
  Config,
};
