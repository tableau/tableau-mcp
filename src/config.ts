import { CorsOptions } from 'cors';
import { existsSync, readFileSync } from 'fs';

import {
  ActivityLogConfig,
  isActivityLogProvider,
  providerConfigSchema as activityLogProviderConfigSchema,
} from './activityLog/types.js';
import { BaseConfig, removeClaudeMcpBundleUserConfigTemplates } from './config.shared.js';
import {
  FeatureGateConfig,
  isFeatureGateProvider,
  providerConfigSchema as featureGateProviderConfigSchema,
} from './features/types.js';
import { log } from './logging/logger.js';
import { isHttpsOrLoopbackUrl } from './server/oauth/loopbackHosts.js';
import {
  isSessionStoreProvider,
  providerConfigSchema as sessionStoreProviderConfigSchema,
  SessionStoreConfig,
} from './sessionStore/types.js';
import { isTelemetryProvider, providerConfigSchema, TelemetryConfig } from './telemetry/types.js';
import { isTransport } from './transports.js';
import invariant from './utils/invariant.js';
import { milliseconds } from './utils/milliseconds.js';
import { parseNumber } from './utils/parseNumber.js';

const authTypes = ['pat', 'uat', 'direct-trust', 'oauth', 'passthrough'] as const;
type AuthType = (typeof authTypes)[number];

function isAuthType(auth: unknown): auth is AuthType {
  return authTypes.some((type) => type === auth);
}

/**
 * Default and bounds for PENDING_DELETION_MAX_AGE_DAYS, the oldest cleanup batch a delete confirm
 * still accepts. The upper bound keeps the residue sweep (list-workbooks / list-datasources with a
 * tags filter) to a handful of calls: every marker that can still authorize a confirm is within it.
 */
export const PENDING_DELETION_MAX_AGE_DAYS_DEFAULT = 30;
export const PENDING_DELETION_MAX_AGE_DAYS_MIN = 1;
export const PENDING_DELETION_MAX_AGE_DAYS_MAX = 90;

export class Config extends BaseConfig {
  auth: AuthType;
  server: string;
  sslKey: string;
  sslCert: string;
  httpPort: number;
  corsOriginConfig: CorsOptions['origin'];
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
  disableSessionManagement: boolean;
  tableauServerVersionCheckIntervalInHours: number;
  passthroughAuthUserSessionCheckIntervalInMinutes: number;
  mcpSiteSettingsCheckIntervalInMinutes: number;
  enableMcpSiteSettings: boolean;
  allowSitesToConfigureRequestOverrides: boolean;
  enablePassthroughAuth: boolean;
  oauth: {
    enabled: boolean;
    embeddedAuthzServer: boolean;
    issuer: string;
    redirectUri: string;
    resourceUri: string;
    globalResourceUris: string[];
    lockSite: boolean;
    jwePrivateKey: string;
    jwePrivateKeyPath: string;
    jwePrivateKeyPassphrase: string | undefined;
    authzCodeTimeoutMs: number;
    accessTokenTimeoutMs: number;
    refreshTokenTimeoutMs: number;
    clientIdSecretPairs: Record<string, string> | null;
    dnsServers: string[];
    enforceScopes: boolean;
    advertiseApiScopes: boolean;
    external: {
      discovery: boolean;
      usernameClaimName: string;
    } | null;
  };
  telemetry: TelemetryConfig;
  latencyMetricName: string;
  featureGate: FeatureGateConfig;
  sessionStore: SessionStoreConfig;
  activityLog: ActivityLogConfig;
  breakGlassDisableGlobally: boolean;
  adminToolsEnabled: boolean;
  pendingDeletionMaxAgeDays: number;
  flowReadToolsEnabled: boolean | undefined;
  localFlowRoots: string[];
  flowWriteToolsEnabled: boolean | undefined;
  insightsToolsEnabled: boolean;
  cspAllowedDomains: string[];
  bucketS3: {
    enabled: boolean;
    bucket: string;
    region: string;
    keyPrefix: string;
    presignTtlSeconds: number;
  };

  constructor() {
    super();

    const cleansedVars = removeClaudeMcpBundleUserConfigTemplates(process.env);
    this.localFlowRoots = [];
    if (cleansedVars.LOCAL_FLOW_ROOTS) {
      try {
        const roots: unknown = JSON.parse(cleansedVars.LOCAL_FLOW_ROOTS);
        if (
          !Array.isArray(roots) ||
          roots.length > 20 ||
          !roots.every((root) => typeof root === 'string' && root.length > 0 && root.length <= 4096)
        )
          throw new Error('invalid');
        this.localFlowRoots = roots;
      } catch {
        throw new Error(
          'LOCAL_FLOW_ROOTS must be a JSON array of at most 20 nonempty directory paths.',
        );
      }
    }
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
      UAT_TENANT_ID: uatTenantId,
      UAT_ISSUER: uatIssuer,
      UAT_USERNAME_CLAIM_NAME: uatUsernameClaimName,
      UAT_USERNAME_CLAIM: uatUsernameClaim,
      UAT_PRIVATE_KEY: uatPrivateKey,
      UAT_PRIVATE_KEY_PATH: uatPrivateKeyPath,
      UAT_KEY_ID: uatKeyId,
      JWT_ADDITIONAL_PAYLOAD: jwtAdditionalPayload,
      DATASOURCE_CREDENTIALS: datasourceCredentials,
      DISABLE_SESSION_MANAGEMENT: disableSessionManagement,
      TABLEAU_SERVER_VERSION_CHECK_INTERVAL_IN_HOURS: tableauServerVersionCheckIntervalInHours,
      PASSTHROUGH_AUTH_USER_SESSION_CHECK_INTERVAL_IN_MINUTES:
        passthroughAuthUserSessionCheckIntervalInMinutes,
      MCP_SITE_SETTINGS_CHECK_INTERVAL_IN_MINUTES: mcpSiteSettingsCheckIntervalInMinutes,
      ENABLE_MCP_SITE_SETTINGS: enableMcpSiteSettings,
      ALLOW_SITES_TO_CONFIGURE_REQUEST_OVERRIDES: allowSitesToConfigureRequestOverrides,
      ENABLE_PASSTHROUGH_AUTH: enablePassthroughAuth,
      DANGEROUSLY_DISABLE_OAUTH: disableOauth,
      OAUTH_EMBEDDED_AUTHZ_SERVER: oauthEmbeddedAuthzServer,
      OAUTH_ISSUER: oauthIssuer,
      OAUTH_LOCK_SITE: oauthLockSite,
      OAUTH_JWE_PRIVATE_KEY: oauthJwePrivateKey,
      OAUTH_JWE_PRIVATE_KEY_PATH: oauthJwePrivateKeyPath,
      OAUTH_JWE_PRIVATE_KEY_PASSPHRASE: oauthJwePrivateKeyPassphrase,
      OAUTH_RESOURCE_URI: oauthResourceUri,
      OAUTH_GLOBAL_RESOURCE_URIS: oauthGlobalResourceUris,
      OAUTH_REDIRECT_URI: redirectUri,
      OAUTH_CLIENT_ID_SECRET_PAIRS: oauthClientIdSecretPairs,
      OAUTH_CIMD_DNS_SERVERS: dnsServers,
      ADVERTISE_API_SCOPES: advertiseApiScopes,
      OAUTH_AUTHORIZATION_CODE_TIMEOUT_MS: authzCodeTimeoutMs,
      OAUTH_ACCESS_TOKEN_TIMEOUT_MS: accessTokenTimeoutMs,
      OAUTH_REFRESH_TOKEN_TIMEOUT_MS: refreshTokenTimeoutMs,
      OAUTH_DISABLE_SCOPES: oauthDisableScopes,
      OAUTH_EXTERNAL_DISCOVERY: oauthExternalDiscovery,
      OAUTH_EXTERNAL_USERNAME_CLAIM_NAME: oauthExternalUsernameClaimName,
      TELEMETRY_PROVIDER: telemetryProvider,
      TELEMETRY_PROVIDER_CONFIG: telemetryProviderConfig,
      FEATURE_GATE_PROVIDER: featureGateProvider,
      FEATURE_GATE_PROVIDER_CONFIG: featureGateProviderConfig,
      SESSION_STORE_PROVIDER: sessionStoreProvider,
      SESSION_STORE_PROVIDER_CONFIG: sessionStoreProviderConfig,
      ACTIVITY_LOG_PROVIDER: activityLogProvider,
      ACTIVITY_LOG_PROVIDER_CONFIG: activityLogProviderConfig,
      LATENCY_METRIC_NAME: latencyMetricName,
      BREAK_GLASS_DISABLE_GLOBALLY: breakGlassDisableGlobally,
      ADMIN_TOOLS_ENABLED: adminToolsEnabled,
      PENDING_DELETION_MAX_AGE_DAYS: pendingDeletionMaxAgeDays,
      FLOW_READ_TOOLS_ENABLED: flowReadToolsEnabled,
      FLOW_WRITE_TOOLS_ENABLED: flowWriteToolsEnabled,
      INSIGHTS_TOOLS_ENABLED: insightsToolsEnabled,
      CSP_ALLOWED_DOMAINS: cspAllowedDomains,
      MCP_S3_BUCKET: bucketS3Bucket,
      AWS_DEFAULT_REGION: awsDefaultRegion,
      MCP_IMAGE_PREFIX: bucketS3KeyPrefix,
      FILE_TTL: bucketS3PresignTtlSeconds,
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
    this.datasourceCredentials = datasourceCredentials ?? '';
    this.disableSessionManagement = disableSessionManagement === 'true';

    this.tableauServerVersionCheckIntervalInHours = parseNumber(
      tableauServerVersionCheckIntervalInHours,
      {
        defaultValue: 1,
        minValue: 1,
        maxValue: 24 * 7, // 7 days
      },
    );

    this.passthroughAuthUserSessionCheckIntervalInMinutes = parseNumber(
      passthroughAuthUserSessionCheckIntervalInMinutes,
      {
        defaultValue: 10,
        minValue: 0,
        maxValue: 60 * 24, // 24 hours
      },
    );

    this.mcpSiteSettingsCheckIntervalInMinutes = parseNumber(
      mcpSiteSettingsCheckIntervalInMinutes,
      {
        defaultValue: 10,
        minValue: 1,
        maxValue: 60 * 24, // 24 hours
      },
    );

    this.enableMcpSiteSettings = enableMcpSiteSettings !== 'false';
    this.allowSitesToConfigureRequestOverrides = allowSitesToConfigureRequestOverrides === 'true';
    const normalizedAuth = auth?.trim().toLowerCase();
    // Like TRANSPORT and the provider vars, an unknown value falls back to the default; warn so a typo (e.g. "passthru") is not silent.
    if (normalizedAuth && !isAuthType(normalizedAuth)) {
      log({
        message: `Unknown AUTH "${auth}"; expected one of ${authTypes.join(', ')}. Falling back to the default.`,
        level: 'warning',
        logger: 'config',
      });
    }
    const purePassthroughAuth = normalizedAuth === 'passthrough';
    this.enablePassthroughAuth = enablePassthroughAuth === 'true' || purePassthroughAuth;
    const disableOauthOverride = disableOauth === 'true';
    const disableScopes = oauthDisableScopes === 'true';
    const enforceScopes = !disableScopes;
    const embeddedAuthzServer = oauthEmbeddedAuthzServer !== 'false';

    if (this.allowSitesToConfigureRequestOverrides && !this.enableMcpSiteSettings) {
      throw new Error(
        'ALLOW_SITES_TO_CONFIGURE_REQUEST_OVERRIDES is "true", but MCP site settings are not enabled.',
      );
    }

    this.oauth = {
      enabled: !purePassthroughAuth && !disableOauthOverride && !!oauthIssuer,
      embeddedAuthzServer,
      issuer: oauthIssuer ?? '',
      resourceUri: oauthResourceUri ?? `http://127.0.0.1:${this.httpPort}`,
      globalResourceUris: oauthGlobalResourceUris
        ? oauthGlobalResourceUris
            .split(',')
            .map((uri) => uri.trim())
            .filter(Boolean)
        : [],
      redirectUri: redirectUri || (oauthIssuer ? `${oauthIssuer}/Callback` : ''),
      lockSite: oauthLockSite !== 'false', // Site locking is enabled by default
      jwePrivateKey: oauthJwePrivateKey ?? '',
      jwePrivateKeyPath: oauthJwePrivateKeyPath ?? '',
      jwePrivateKeyPassphrase: oauthJwePrivateKeyPassphrase || undefined,
      dnsServers: dnsServers
        ? dnsServers.split(',').map((ip) => ip.trim())
        : ['1.1.1.1', '1.0.0.1' /* Cloudflare public DNS */],
      authzCodeTimeoutMs: parseNumber(authzCodeTimeoutMs, {
        defaultValue: milliseconds.fromMinutes(10),
        minValue: 0,
        maxValue: milliseconds.fromHours(1),
      }),
      accessTokenTimeoutMs: parseNumber(accessTokenTimeoutMs, {
        defaultValue: milliseconds.fromHours(1),
        minValue: 0,
        maxValue: milliseconds.fromDays(30),
      }),
      refreshTokenTimeoutMs: parseNumber(refreshTokenTimeoutMs, {
        defaultValue: milliseconds.fromDays(30),
        minValue: 0,
        maxValue: milliseconds.fromYears(1),
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
      enforceScopes,
      advertiseApiScopes: advertiseApiScopes === 'true',
      external: [oauthExternalDiscovery === 'true', oauthExternalUsernameClaimName].some(Boolean)
        ? {
            discovery: oauthExternalDiscovery === 'true',
            usernameClaimName: oauthExternalUsernameClaimName?.trim() || 'sub',
          }
        : null,
    };

    if (
      this.oauth.clientIdSecretPairs &&
      Object.keys(this.oauth.clientIdSecretPairs).length === 0
    ) {
      throw new Error(
        `OAUTH_CLIENT_ID_SECRET_PAIRS is in an invalid format: ${oauthClientIdSecretPairs}. Should be in the format: clientId:secret`,
      );
    }

    const parsedProvider = isTelemetryProvider(telemetryProvider) ? telemetryProvider : 'noop';
    if (parsedProvider === 'custom') {
      if (!telemetryProviderConfig) {
        throw new Error(
          'TELEMETRY_PROVIDER_CONFIG is required when TELEMETRY_PROVIDER is "custom"',
        );
      }
      this.telemetry = {
        provider: 'custom',
        providerConfig: providerConfigSchema.parse(JSON.parse(telemetryProviderConfig)),
      };
    } else {
      this.telemetry = {
        provider: 'noop',
      };
    }

    this.latencyMetricName = latencyMetricName || 'http_server_1agg1_request_duration';

    // Feature gate provider configuration (similar to telemetry provider)
    if (isFeatureGateProvider(featureGateProvider) && featureGateProvider === 'custom') {
      if (!featureGateProviderConfig) {
        throw new Error(
          'FEATURE_GATE_PROVIDER_CONFIG is required when FEATURE_GATE_PROVIDER is "custom"',
        );
      }
      this.featureGate = {
        provider: 'custom',
        providerConfig: featureGateProviderConfigSchema.parse(
          JSON.parse(featureGateProviderConfig),
        ),
      };
    } else {
      this.featureGate = {
        provider: 'server',
      };
    }

    // Session store provider configuration (similar to feature gate provider)
    if (isSessionStoreProvider(sessionStoreProvider) && sessionStoreProvider === 'custom') {
      if (!sessionStoreProviderConfig) {
        throw new Error(
          'SESSION_STORE_PROVIDER_CONFIG is required when SESSION_STORE_PROVIDER is "custom"',
        );
      }
      this.sessionStore = {
        provider: 'custom',
        providerConfig: sessionStoreProviderConfigSchema.parse(
          JSON.parse(sessionStoreProviderConfig),
        ),
      };
    } else {
      this.sessionStore = {
        provider: 'memory',
      };
    }

    // Activity Log provider configuration (similar to feature gate provider)
    if (isActivityLogProvider(activityLogProvider) && activityLogProvider === 'custom') {
      if (!activityLogProviderConfig) {
        throw new Error(
          'ACTIVITY_LOG_PROVIDER_CONFIG is required when ACTIVITY_LOG_PROVIDER is "custom"',
        );
      }
      this.activityLog = {
        provider: 'custom',
        providerConfig: activityLogProviderConfigSchema.parse(
          JSON.parse(activityLogProviderConfig),
        ),
      };
    } else {
      this.activityLog = {
        provider: 'noop',
      };
    }

    this.breakGlassDisableGlobally = breakGlassDisableGlobally === 'true';
    this.adminToolsEnabled = adminToolsEnabled === 'true';
    // Oldest cleanup batch (days) a delete confirm still accepts. Server-level only — deliberately not
    // a site/request override, so a caller cannot widen the window an orphaned marker stays usable.
    this.pendingDeletionMaxAgeDays = Math.floor(
      parseNumber(pendingDeletionMaxAgeDays, {
        defaultValue: PENDING_DELETION_MAX_AGE_DAYS_DEFAULT,
        minValue: PENDING_DELETION_MAX_AGE_DAYS_MIN,
        maxValue: PENDING_DELETION_MAX_AGE_DAYS_MAX,
      }),
    );
    this.flowReadToolsEnabled = parseOptionalBoolean(flowReadToolsEnabled);
    this.flowWriteToolsEnabled = parseOptionalBoolean(flowWriteToolsEnabled);
    // Insight-cards tools (generate-insight-cards) are gated off by default while
    // the insights rollout is staged (keeps hosts like Slackbot stable); set
    // INSIGHTS_TOOLS_ENABLED=true to register them.
    this.insightsToolsEnabled = insightsToolsEnabled === 'true';

    // S3 offload: when MCP_S3_BUCKET is set, view-image and view-data tools
    // upload the payload (rendered image or CSV) to S3 and return a short-lived
    // presigned URL instead of inlining base64/text. AWS credentials are
    // resolved via the default AWS SDK credential chain (IAM role / instance
    // profile / standard AWS_* env vars), so no credentials are read here. When
    // unset, the tools fall back to returning the payload inline (unchanged
    // behavior).
    //
    // `keyPrefix` (MCP_IMAGE_PREFIX) is the shared base folder; each tool
    // appends its own segment (e.g. `view-images/`, `view-data/`), so an unset
    // base falls back to the per-tool default rather than a global one.
    const bucketS3BucketValue = bucketS3Bucket?.trim() ?? '';
    this.bucketS3 = {
      enabled: !!bucketS3BucketValue,
      bucket: bucketS3BucketValue,
      region: awsDefaultRegion?.trim() || '',
      keyPrefix: bucketS3KeyPrefix?.trim() || '',
      presignTtlSeconds: parseNumber(bucketS3PresignTtlSeconds, {
        defaultValue: 60,
        minValue: 5,
        maxValue: 900,
      }),
    };

    this.auth = isAuthType(normalizedAuth) ? normalizedAuth : this.oauth.enabled ? 'oauth' : 'pat';
    this.transport = isTransport(transport) ? transport : this.oauth.enabled ? 'http' : 'stdio';

    if (this.oauth.external) {
      validateOAuthExternal({
        auth: this.auth,
        oauth: this.oauth,
        external: this.oauth.external,
        usernameTemplate: jwtSubClaim,
      });
    }

    if (
      this.transport === 'http' &&
      this.auth !== 'passthrough' &&
      !disableOauthOverride &&
      !this.oauth.issuer
    ) {
      throw new Error(
        'OAUTH_ISSUER must be set when TRANSPORT is "http" unless DANGEROUSLY_DISABLE_OAUTH is "true"',
      );
    }

    if (this.auth === 'passthrough' && this.transport === 'stdio') {
      throw new Error('TRANSPORT must be "http" when AUTH is "passthrough"');
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
      if (this.oauth.embeddedAuthzServer) {
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
      }

      if (this.transport === 'stdio') {
        throw new Error('TRANSPORT must be "http" when OAUTH_ISSUER is set');
      }
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

    // Configure CSP domains with serverOrigin in defaults
    const serverOrigin = this.server ? new URL(this.server).origin : '';
    const defaultDomains = [
      'https://*.online.tableau.com',
      'https://*.tableau.com',
      ...(serverOrigin ? [serverOrigin] : []),
    ];
    const customDomains = cspAllowedDomains
      ? cspAllowedDomains.split(',').map((d) => d.trim())
      : [];
    this.cspAllowedDomains = [...defaultDomains, ...customDomains];

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

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return undefined;
}

function validateServer(server: string): void {
  if (!['https://', 'http://'].find((prefix) => server.startsWith(prefix))) {
    throw new Error(
      `The environment variable SERVER must start with "http://" or "https://": ${server}`,
    );
  }

  try {
    new URL(server);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The environment variable SERVER is not a valid URL: ${server} -- ${errorMessage}`,
    );
  }
}

function validateOAuthExternal({
  auth,
  oauth: { enabled, embeddedAuthzServer, issuer },
  external: { discovery },
  usernameTemplate,
}: {
  auth: AuthType;
  oauth: Config['oauth'];
  external: NonNullable<Config['oauth']['external']>;
  usernameTemplate: string | undefined;
}): void {
  if (!enabled || embeddedAuthzServer) {
    throw new Error(
      'OAUTH_EXTERNAL_* variables require OAUTH_ISSUER to be set and OAUTH_EMBEDDED_AUTHZ_SERVER to be "false"',
    );
  }

  if (!discovery) {
    throw new Error('OAUTH_EXTERNAL_* variables require OAUTH_EXTERNAL_DISCOVERY to be "true"');
  }

  // The issuer becomes the discovery document's fetch target.
  const issuerUrl = validateHttpsOrLoopbackUri('OAUTH_ISSUER', issuer);
  // undici repeats the full URL, password included, in its errors.
  if (issuerUrl.username || issuerUrl.password) {
    throw new Error(
      'The environment variable OAUTH_ISSUER must not contain a username or password',
    );
  }

  if (auth !== 'direct-trust') {
    throw new Error('When OAUTH_EXTERNAL_DISCOVERY="true" is set, AUTH must be "direct-trust"');
  }

  if (!usernameTemplate?.includes('{OAUTH_USERNAME}')) {
    throw new Error(
      'When OAUTH_EXTERNAL_* is set and AUTH is "direct-trust", JWT_SUB_CLAIM must contain {OAUTH_USERNAME}',
    );
  }
}

function validateHttpsOrLoopbackUri(name: string, uri: string): URL {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new Error(`The environment variable ${name} is not a valid URL`);
  }

  if (!isHttpsOrLoopbackUrl(url)) {
    throw new Error(`The environment variable ${name} must use https unless its host is loopback`);
  }

  return url;
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

export const getConfig = (): Config => new Config();
