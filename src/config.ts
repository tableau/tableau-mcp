import { CorsOptions } from 'cors';

import { isToolName, ToolName } from './tools/toolName.js';
import { isTransport, TransportName } from './transports.js';
import invariant from './utils/invariant.js';

const authTypes = ['pat', 'direct-trust'] as const;
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
  jwtAdditionalPayload: string;
  datasourceCredentials: string;
  defaultLogLevel: string;
  disableLogMasking: boolean;
  includeTools: Array<ToolName>;
  excludeTools: Array<ToolName>;
  maxResultLimit: number | null;
  disableQueryDatasourceFilterValidation: boolean;

  constructor() {
    const cleansedVars = removeClaudeDesktopExtensionUserConfigTemplates(process.env);
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
      JWT_ADDITIONAL_PAYLOAD: jwtAdditionalPayload,
      DATASOURCE_CREDENTIALS: datasourceCredentials,
      DEFAULT_LOG_LEVEL: defaultLogLevel,
      DISABLE_LOG_MASKING: disableLogMasking,
      INCLUDE_TOOLS: includeTools,
      EXCLUDE_TOOLS: excludeTools,
      MAX_RESULT_LIMIT: maxResultLimit,
      DISABLE_QUERY_DATASOURCE_FILTER_VALIDATION: disableQueryDatasourceFilterValidation,
    } = cleansedVars;

    const defaultPort = 3927;
    const httpPort = cleansedVars[httpPortEnvVarName?.trim() || 'PORT'] || defaultPort.toString();
    const httpPortNumber = parseInt(httpPort, 10);

    this.siteName = siteName ?? '';
    this.auth = authTypes.find((type) => type === auth) ?? 'pat';
    this.transport = isTransport(transport) ? transport : 'stdio';
    this.sslKey = sslKey?.trim() ?? '';
    this.sslCert = sslCert?.trim() ?? '';
    this.httpPort = isNaN(httpPortNumber) ? defaultPort : httpPortNumber;
    this.corsOriginConfig = getCorsOriginConfig(corsOriginConfig?.trim() ?? '');
    this.datasourceCredentials = datasourceCredentials ?? '';
    this.defaultLogLevel = defaultLogLevel ?? 'debug';
    this.disableLogMasking = disableLogMasking === 'true';
    this.disableQueryDatasourceFilterValidation = disableQueryDatasourceFilterValidation === 'true';

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

// When the user does not provide a site name in the Claude Desktop Extension configuration,
// Claude doesn't replace its value and sets the site name to "${user_config.site_name}".
function removeClaudeDesktopExtensionUserConfigTemplates(
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

export const getConfig = (): Config => new Config();

export const exportedForTesting = {
  Config,
};
