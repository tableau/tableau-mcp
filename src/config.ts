import { CorsOptions } from 'cors';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

import { isToolGroupName, isToolName, toolGroups, ToolName } from './tools/toolName.js';
import { isTransport, TransportName } from './transports.js';
import invariant from './utils/invariant.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export const TEN_MINUTES_IN_MS = 10 * 60 * 1000;
export const ONE_HOUR_IN_MS = 60 * 60 * 1000;
export const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
export const THIRTY_DAYS_IN_MS = 30 * 24 * 60 * 60 * 1000;
export const ONE_YEAR_IN_MS = 365.25 * 24 * 60 * 60 * 1000;

const authTypes = ['pat', 'uat', 'direct-trust', 'oauth'] as const;
type AuthType = (typeof authTypes)[number];

function isAuthType(auth: unknown): auth is AuthType {
  return !!authTypes.find((type) => type === auth);
}

export type BoundedContext = {
  projectIds: Set<string> | null;
  datasourceIds: Set<string> | null;
  workbookIds: Set<string> | null;
};

export class Config {
  auth: AuthType;
  server: string;
  transport: TransportName;
  sslKey: string;
  sslCert: string;
  httpPort: number;
  corsOriginConfig: CorsOptions['origin'];
  trustProxyConfig: boolean | number | string | null;
  siteName: string;
  patName: string;
  patValue: string;
  jwtUsername: string;
  connectedAppClientId: string;
  connectedAppSecretId: string;
  connectedAppSecretValue: string;
  uatTenantId: string;
  uatIssuer: string;
  uatUsernameClaimName: string;
  uatPrivateKey: string;
  uatKeyId: string;
  jwtAdditionalPayload: string;
  datasourceCredentials: string;
  defaultLogLevel: string;
  disableLogMasking: boolean;
  includeTools: Array<ToolName>;
  excludeTools: Array<ToolName>;
  maxResultLimit: number | null;
  disableQueryDatasourceValidationRequests: boolean;
  disableMetadataApiRequests: boolean;
  disableSessionManagement: boolean;
  enableServerLogging: boolean;
  serverLogDirectory: string;
  boundedContext: BoundedContext;
  tableauServerVersionCheckIntervalInHours: number;
  oauth: {
    enabled: boolean;
    issuer: string;
    redirectUri: string;
    jwePrivateKey: string;
    jwePrivateKeyPath: string;
    jwePrivateKeyPassphrase: string | undefined;
    authzCodeTimeoutMs: number;
    accessTokenTimeoutMs: number;
    refreshTokenTimeoutMs: number;
    clientIdSecretPairs: Record<string, string> | null;
    dnsServers: string[];
  };

  constructor() {
    const cleansedVars = removeClaudeMcpBundleUserConfigTemplates(process.env);
    const {
      AUTH: auth,
      SERVER: server,
      SITE_NAME: siteName,
      TRANSPORT: transport,
      SSL_KEY: sslKey,
      SSL_CERT: sslCert,
      HTTP_PORT_ENV_VAR_NAME: httpPortEnvVarName,
      CORS_ORIGIN_CONFIG: corsOriginConfig,
      TRUST_PROXY_CONFIG: trustProxyConfig,
      PAT_NAME: patName,
      PAT_VALUE: patValue,
      JWT_SUB_CLAIM: jwtSubClaim,
      CONNECTED_APP_CLIENT_ID: clientId,
      CONNECTED_APP_SECRET_ID: secretId,
      CONNECTED_APP_SECRET_VALUE: secretValue,
      UAT_TENANT_ID: uatTenantId,
      UAT_ISSUER: uatIssuer,
      UAT_USERNAME_CLAIM_NAME: uatUsernameClaimName,
      UAT_USERNAME_CLAIM: uatUsernameClaim,
      UAT_PRIVATE_KEY: uatPrivateKey,
      UAT_PRIVATE_KEY_PATH: uatPrivateKeyPath,
      UAT_KEY_ID: uatKeyId,
      JWT_ADDITIONAL_PAYLOAD: jwtAdditionalPayload,
      DATASOURCE_CREDENTIALS: datasourceCredentials,
      DEFAULT_LOG_LEVEL: defaultLogLevel,
      DISABLE_LOG_MASKING: disableLogMasking,
      INCLUDE_TOOLS: includeTools,
      EXCLUDE_TOOLS: excludeTools,
      MAX_RESULT_LIMIT: maxResultLimit,
      DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS: disableQueryDatasourceValidationRequests,
      DISABLE_METADATA_API_REQUESTS: disableMetadataApiRequests,
      DISABLE_SESSION_MANAGEMENT: disableSessionManagement,
      ENABLE_SERVER_LOGGING: enableServerLogging,
      SERVER_LOG_DIRECTORY: serverLogDirectory,
      INCLUDE_PROJECT_IDS: includeProjectIds,
      INCLUDE_DATASOURCE_IDS: includeDatasourceIds,
      INCLUDE_WORKBOOK_IDS: includeWorkbookIds,
      TABLEAU_SERVER_VERSION_CHECK_INTERVAL_IN_HOURS: tableauServerVersionCheckIntervalInHours,
      DANGEROUSLY_DISABLE_OAUTH: disableOauth,
      OAUTH_ISSUER: oauthIssuer,
      OAUTH_JWE_PRIVATE_KEY: oauthJwePrivateKey,
      OAUTH_JWE_PRIVATE_KEY_PATH: oauthJwePrivateKeyPath,
      OAUTH_JWE_PRIVATE_KEY_PASSPHRASE: oauthJwePrivateKeyPassphrase,
      OAUTH_REDIRECT_URI: redirectUri,
      OAUTH_CLIENT_ID_SECRET_PAIRS: oauthClientIdSecretPairs,
      OAUTH_CIMD_DNS_SERVERS: dnsServers,
      OAUTH_AUTHORIZATION_CODE_TIMEOUT_MS: authzCodeTimeoutMs,
      OAUTH_ACCESS_TOKEN_TIMEOUT_MS: accessTokenTimeoutMs,
      OAUTH_REFRESH_TOKEN_TIMEOUT_MS: refreshTokenTimeoutMs,
    } = cleansedVars;

    let jwtUsername = '';

    this.siteName = siteName ?? '';

    this.sslKey = sslKey?.trim() ?? '';
    this.sslCert = sslCert?.trim() ?? '';
    this.httpPort = parseNumber(cleansedVars[httpPortEnvVarName?.trim() || 'PORT'], {
      defaultValue: 3927,
      minValue: 1,
      maxValue: 65535,
    });
    this.corsOriginConfig = getCorsOriginConfig(corsOriginConfig?.trim() ?? '');
    this.trustProxyConfig = getTrustProxyConfig(trustProxyConfig?.trim() ?? '');
    this.datasourceCredentials = datasourceCredentials ?? '';
    this.defaultLogLevel = defaultLogLevel ?? 'debug';
    this.disableLogMasking = disableLogMasking === 'true';
    this.disableQueryDatasourceValidationRequests =
      disableQueryDatasourceValidationRequests === 'true';
    this.disableMetadataApiRequests = disableMetadataApiRequests === 'true';
    this.disableSessionManagement = disableSessionManagement === 'true';
    this.enableServerLogging = enableServerLogging === 'true';
    this.serverLogDirectory = serverLogDirectory || join(__dirname, 'logs');
    this.boundedContext = {
      projectIds: createSetFromCommaSeparatedString(includeProjectIds),
      datasourceIds: createSetFromCommaSeparatedString(includeDatasourceIds),
      workbookIds: createSetFromCommaSeparatedString(includeWorkbookIds),
    };

    if (this.boundedContext.projectIds?.size === 0) {
      throw new Error(
        'When set, the environment variable INCLUDE_PROJECT_IDS must have at least one value',
      );
    }

    if (this.boundedContext.datasourceIds?.size === 0) {
      throw new Error(
        'When set, the environment variable INCLUDE_DATASOURCE_IDS must have at least one value',
      );
    }

    if (this.boundedContext.workbookIds?.size === 0) {
      throw new Error(
        'When set, the environment variable INCLUDE_WORKBOOK_IDS must have at least one value',
      );
    }

    this.tableauServerVersionCheckIntervalInHours = parseNumber(
      tableauServerVersionCheckIntervalInHours,
      {
        defaultValue: 1,
        minValue: 1,
        maxValue: 24 * 7, // 7 days
      },
    );

    const disableOauthOverride = disableOauth === 'true';
    this.oauth = {
      enabled: disableOauthOverride ? false : !!oauthIssuer,
      issuer: oauthIssuer ?? '',
      redirectUri: redirectUri || (oauthIssuer ? `${oauthIssuer}/Callback` : ''),
      jwePrivateKey: oauthJwePrivateKey ?? '',
      jwePrivateKeyPath: oauthJwePrivateKeyPath ?? '',
      jwePrivateKeyPassphrase: oauthJwePrivateKeyPassphrase || undefined,
      dnsServers: dnsServers
        ? dnsServers.split(',').map((ip) => ip.trim())
        : ['1.1.1.1', '1.0.0.1' /* Cloudflare public DNS */],
      authzCodeTimeoutMs: parseNumber(authzCodeTimeoutMs, {
        defaultValue: TEN_MINUTES_IN_MS,
        minValue: 0,
        maxValue: ONE_HOUR_IN_MS,
      }),
      accessTokenTimeoutMs: parseNumber(accessTokenTimeoutMs, {
        defaultValue: ONE_HOUR_IN_MS,
        minValue: 0,
        maxValue: THIRTY_DAYS_IN_MS,
      }),
      refreshTokenTimeoutMs: parseNumber(refreshTokenTimeoutMs, {
        defaultValue: THIRTY_DAYS_IN_MS,
        minValue: 0,
        maxValue: ONE_YEAR_IN_MS,
      }),
      clientIdSecretPairs: oauthClientIdSecretPairs
        ? oauthClientIdSecretPairs.split(',').reduce<Record<string, string>>((acc, curr) => {
            const [clientId, secret] = curr.split(':');
            if (clientId && secret) {
              acc[clientId] = secret;
            }
            return acc;
          }, {})
        : null,
    };

    this.auth = isAuthType(auth) ? auth : this.oauth.enabled ? 'oauth' : 'pat';
    this.transport = isTransport(transport) ? transport : this.oauth.enabled ? 'http' : 'stdio';

    if (this.transport === 'http' && !disableOauthOverride && !this.oauth.issuer) {
      throw new Error(
        'OAUTH_ISSUER must be set when TRANSPORT is "http" unless DANGEROUSLY_DISABLE_OAUTH is "true"',
      );
    }

    if (this.auth === 'oauth') {
      if (disableOauthOverride) {
        throw new Error('When AUTH is "oauth", DANGEROUSLY_DISABLE_OAUTH cannot be "true"');
      }

      if (!this.oauth.issuer) {
        throw new Error('When AUTH is "oauth", OAUTH_ISSUER must be set');
      }
    } else {
      invariant(server, 'The environment variable SERVER is not set');
      validateServer(server);
    }

    if (this.oauth.enabled) {
      invariant(this.oauth.redirectUri, 'The environment variable OAUTH_REDIRECT_URI is not set');

      if (!this.oauth.jwePrivateKey && !this.oauth.jwePrivateKeyPath) {
        throw new Error(
          'One of the environment variables: OAUTH_JWE_PRIVATE_KEY_PATH or OAUTH_JWE_PRIVATE_KEY must be set',
        );
      }

      if (this.oauth.jwePrivateKey && this.oauth.jwePrivateKeyPath) {
        throw new Error(
          'Only one of the environment variables: OAUTH_JWE_PRIVATE_KEY or OAUTH_JWE_PRIVATE_KEY_PATH must be set',
        );
      }

      if (
        this.oauth.jwePrivateKeyPath &&
        process.env.TABLEAU_MCP_TEST !== 'true' &&
        !existsSync(this.oauth.jwePrivateKeyPath)
      ) {
        throw new Error(
          `OAuth JWE private key path does not exist: ${this.oauth.jwePrivateKeyPath}`,
        );
      }

      if (this.transport === 'stdio') {
        throw new Error('TRANSPORT must be "http" when OAUTH_ISSUER is set');
      }
    }

    const maxResultLimitNumber = maxResultLimit ? parseInt(maxResultLimit) : NaN;
    this.maxResultLimit =
      isNaN(maxResultLimitNumber) || maxResultLimitNumber <= 0 ? null : maxResultLimitNumber;

    this.includeTools = includeTools
      ? includeTools.split(',').flatMap((s) => {
          const v = s.trim();
          return isToolName(v) ? v : isToolGroupName(v) ? toolGroups[v] : [];
        })
      : [];

    this.excludeTools = excludeTools
      ? excludeTools.split(',').flatMap((s) => {
          const v = s.trim();
          return isToolName(v) ? v : isToolGroupName(v) ? toolGroups[v] : [];
        })
      : [];

    if (this.includeTools.length > 0 && this.excludeTools.length > 0) {
      throw new Error('Cannot include and exclude tools simultaneously');
    }

    if (this.auth === 'pat') {
      invariant(patName, 'The environment variable PAT_NAME is not set');
      invariant(patValue, 'The environment variable PAT_VALUE is not set');
    } else if (this.auth === 'direct-trust') {
      invariant(jwtSubClaim, 'The environment variable JWT_SUB_CLAIM is not set');
      invariant(clientId, 'The environment variable CONNECTED_APP_CLIENT_ID is not set');
      invariant(secretId, 'The environment variable CONNECTED_APP_SECRET_ID is not set');
      invariant(secretValue, 'The environment variable CONNECTED_APP_SECRET_VALUE is not set');

      jwtUsername = jwtSubClaim ?? '';
    } else if (this.auth === 'uat') {
      invariant(uatTenantId, 'The environment variable UAT_TENANT_ID is not set');
      invariant(uatIssuer, 'The environment variable UAT_ISSUER is not set');

      if (!uatUsernameClaim && !jwtSubClaim) {
        throw new Error(
          'One of the environment variables: UAT_USERNAME_CLAIM or JWT_SUB_CLAIM must be set',
        );
      }

      jwtUsername = uatUsernameClaim ?? jwtSubClaim ?? '';

      if (!uatPrivateKey && !uatPrivateKeyPath) {
        throw new Error(
          'One of the environment variables: UAT_PRIVATE_KEY_PATH or UAT_PRIVATE_KEY must be set',
        );
      }

      if (uatPrivateKey && uatPrivateKeyPath) {
        throw new Error(
          'Only one of the environment variables: UAT_PRIVATE_KEY or UAT_PRIVATE_KEY_PATH must be set',
        );
      }

      if (
        uatPrivateKeyPath &&
        process.env.TABLEAU_MCP_TEST !== 'true' &&
        !existsSync(uatPrivateKeyPath)
      ) {
        throw new Error(`UAT private key path does not exist: ${uatPrivateKeyPath}`);
      }
    }

    this.server = server ?? '';
    this.patName = patName ?? '';
    this.patValue = patValue ?? '';
    this.jwtUsername = jwtUsername ?? '';
    this.connectedAppClientId = clientId ?? '';
    this.connectedAppSecretId = secretId ?? '';
    this.connectedAppSecretValue = secretValue ?? '';
    this.uatTenantId = uatTenantId ?? '';
    this.uatIssuer = uatIssuer ?? '';
    this.uatUsernameClaimName = uatUsernameClaimName || 'email';
    this.uatPrivateKey =
      uatPrivateKey || (uatPrivateKeyPath ? readFileSync(uatPrivateKeyPath, 'utf8') : '');
    this.uatKeyId = uatKeyId ?? '';
    this.jwtAdditionalPayload = jwtAdditionalPayload || '{}';
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

function getTrustProxyConfig(trustProxyConfig: string): boolean | number | string | null {
  if (!trustProxyConfig) {
    return null;
  }

  if (trustProxyConfig.match(/^true|false$/i)) {
    return trustProxyConfig.toLowerCase() === 'true';
  }

  if (trustProxyConfig.match(/^\d+$/)) {
    return parseInt(trustProxyConfig, 10);
  }

  return trustProxyConfig;
}

// Creates a set from a comma-separated string of values.
// Returns null if the value is undefined.
function createSetFromCommaSeparatedString(value: string | undefined): Set<string> | null {
  if (value === undefined) {
    return null;
  }

  return new Set(
    value
      .trim()
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

// When the user does not provide a site name in the Claude MCP Bundle configuration,
// Claude doesn't replace its value and sets the site name to "${user_config.site_name}".
function removeClaudeMcpBundleUserConfigTemplates(
  envVars: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return Object.entries(envVars).reduce<Record<string, string | undefined>>((acc, [key, value]) => {
    if (value?.startsWith('${user_config.')) {
      acc[key] = '';
    } else {
      acc[key] = value;
    }
    return acc;
  }, {});
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
