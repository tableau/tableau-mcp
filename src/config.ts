import { CorsOptions } from 'cors';

import { isToolName, ToolName } from './tools/toolName.js';
import { isTransport, TransportName } from './transports.js';
import invariant from './utils/invariant.js';

const TEN_MINUTES_IN_MS = 10 * 60 * 1000;
const ONE_HOUR_IN_MS = 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_IN_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_IN_MS = 30 * 24 * 60 * 60 * 1000;
const ONE_YEAR_IN_MS = 365.25 * 24 * 60 * 60 * 1000;

const authTypes = ['pat', 'oauth', 'direct-trust'] as const;
type AuthType = (typeof authTypes)[number];

export class Config {
  auth: AuthType;
  server: string;
  transport: TransportName;
  sslKey: string;
  sslCert: string;
  httpPort: number;
  corsOriginConfig: CorsOptions['origin'];
  siteName: string;
  patName: string;
  patValue: string;
  jwtSubClaim: string;
  connectedAppClientId: string;
  connectedAppSecretId: string;
  connectedAppSecretValue: string;
  connectedAppJwtAdditionalPayload: string;
  datasourceCredentials: string;
  defaultLogLevel: string;
  disableLogMasking: boolean;
  includeTools: Array<ToolName>;
  excludeTools: Array<ToolName>;
  maxResultLimit: number | null;
  disableQueryDatasourceFilterValidation: boolean;
  oauth: {
    enabled: boolean;
    issuer: string;
    redirectUri: string;
    jwtSecret: string;
    authzCodeTimeoutMs: number;
    accessTokenTimeoutMs: number;
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
      JWT_SUB_CLAIM: jwtSubClaim,
      CONNECTED_APP_CLIENT_ID: clientId,
      CONNECTED_APP_SECRET_ID: secretId,
      CONNECTED_APP_SECRET_VALUE: secretValue,
      CONNECTED_APP_JWT_ADDITIONAL_PAYLOAD: connectedAppJwtAdditionalPayload,
      DATASOURCE_CREDENTIALS: datasourceCredentials,
      DEFAULT_LOG_LEVEL: defaultLogLevel,
      DISABLE_LOG_MASKING: disableLogMasking,
      OAUTH_ISSUER: oauthIssuer,
      OAUTH_JWT_SECRET: jwtSecret,
      OAUTH_REDIRECT_URI: redirectUri,
      OAUTH_AUTHORIZATION_CODE_TIMEOUT_MS: authzCodeTimeoutMs,
      OAUTH_ACCESS_TOKEN_TIMEOUT_MS: accessTokenTimeoutMs,
      OAUTH_REFRESH_TOKEN_TIMEOUT_MS: refreshTokenTimeoutMs,
      INCLUDE_TOOLS: includeTools,
      EXCLUDE_TOOLS: excludeTools,
      MAX_RESULT_LIMIT: maxResultLimit,
      DISABLE_QUERY_DATASOURCE_FILTER_VALIDATION: disableQueryDatasourceFilterValidation,
    } = process.env;

    this.siteName = siteName ?? '';
    this.auth = authTypes.find((type) => type === auth) ?? 'pat';
    this.sslKey = sslKey?.trim() ?? '';
    this.sslCert = sslCert?.trim() ?? '';
    this.httpPort = parseNumber(process.env[httpPortEnvVarName?.trim() || 'PORT'], {
      defaultValue: 3927,
      minValue: 1,
      maxValue: 65535,
    });
    this.corsOriginConfig = getCorsOriginConfig(corsOriginConfig?.trim() ?? '');
    this.datasourceCredentials = datasourceCredentials ?? '';
    this.defaultLogLevel = defaultLogLevel ?? 'debug';
    this.disableLogMasking = disableLogMasking === 'true';
    this.disableQueryDatasourceFilterValidation = disableQueryDatasourceFilterValidation === 'true';
    this.oauth = {
      enabled: !!oauthIssuer,
      issuer: oauthIssuer ?? '',
      redirectUri: redirectUri || (oauthIssuer ? `${oauthIssuer}/Callback` : ''),
      jwtSecret: jwtSecret ?? '',
      authzCodeTimeoutMs: parseNumber(authzCodeTimeoutMs, {
        defaultValue: TEN_MINUTES_IN_MS,
        minValue: 0,
        maxValue: ONE_HOUR_IN_MS,
      }),
      accessTokenTimeoutMs: parseNumber(accessTokenTimeoutMs, {
        defaultValue: TWENTY_FOUR_HOURS_IN_MS,
        minValue: 0,
        maxValue: THIRTY_DAYS_IN_MS,
      }),
      refreshTokenTimeoutMs: parseNumber(refreshTokenTimeoutMs, {
        defaultValue: THIRTY_DAYS_IN_MS,
        minValue: 0,
        maxValue: ONE_YEAR_IN_MS,
      }),
    };

    this.transport = isTransport(transport) ? transport : this.oauth.enabled ? 'http' : 'stdio';

    if (this.oauth.enabled) {
      invariant(this.oauth.issuer, 'The environment variable OAUTH_ISSUER is not set');
      invariant(this.oauth.redirectUri, 'The environment variable OAUTH_REDIRECT_URI is not set');
      invariant(this.oauth.jwtSecret, 'The environment variable OAUTH_JWT_SECRET is not set');

      if (this.transport === 'stdio') {
        throw new Error('TRANSPORT must be "http" when OAUTH_ISSUER is set');
      }
    } else if (this.auth === 'oauth') {
      throw new Error('When auth is "oauth", OAUTH_ISSUER must be set');
    }

    if (this.auth !== 'oauth') {
      invariant(this.siteName, 'The environment variable SITE_NAME is not set');
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
    } else if (this.auth === 'direct-trust') {
      invariant(jwtSubClaim, 'The environment variable JWT_SUB_CLAIM is not set');
      invariant(clientId, 'The environment variable CONNECTED_APP_CLIENT_ID is not set');
      invariant(secretId, 'The environment variable CONNECTED_APP_SECRET_ID is not set');
      invariant(secretValue, 'The environment variable CONNECTED_APP_SECRET_VALUE is not set');
    }

    this.server = server;
    this.patName = patName ?? '';
    this.patValue = patValue ?? '';
    this.jwtSubClaim = jwtSubClaim ?? '';
    this.connectedAppClientId = clientId ?? '';
    this.connectedAppSecretId = secretId ?? '';
    this.connectedAppSecretValue = secretValue ?? '';
    this.connectedAppJwtAdditionalPayload = connectedAppJwtAdditionalPayload ?? '{}';
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

function parseNumber(
  value: string | undefined,
  {
    defaultValue,
    minValue,
    maxValue,
  }: { defaultValue: number; minValue?: number; maxValue?: number } = {
    defaultValue: 0,
    minValue: Number.NEGATIVE_INFINITY,
    maxValue: Number.POSITIVE_INFINITY,
  },
): number {
  if (!value) {
    return defaultValue;
  }

  const number = parseFloat(value);
  return isNaN(number) ||
    (minValue !== undefined && number < minValue) ||
    (maxValue !== undefined && number > maxValue)
    ? defaultValue
    : number;
}

export const getConfig = (): Config => new Config();

export const exportedForTesting = {
  Config,
  parseNumber,
};
