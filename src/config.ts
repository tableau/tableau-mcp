import { CorsOptions } from 'cors';
import { join } from 'path';
import { fileURLToPath } from 'url';

import { isToolGroupName, isToolName, toolGroups, ToolName } from './tools/toolName.js';
import { isTransport, TransportName } from './transports.js';
import invariant from './utils/invariant.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const authTypes = ['pat', 'direct-trust'] as const;
type AuthType = (typeof authTypes)[number];

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
  disableMetadataApiRequests: boolean;
  enableServerLogging: boolean;
  serverLogDirectory: string;
  boundedContext: BoundedContext;

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
      DISABLE_METADATA_API_REQUESTS: disableMetadataApiRequests,
      ENABLE_SERVER_LOGGING: enableServerLogging,
      SERVER_LOG_DIRECTORY: serverLogDirectory,
      INCLUDE_PROJECT_IDS: includeProjectIds,
      INCLUDE_DATASOURCE_IDS: includeDatasourceIds,
      INCLUDE_WORKBOOK_IDS: includeWorkbookIds,
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
    this.disableMetadataApiRequests = disableMetadataApiRequests === 'true';
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

export const getConfig = (): Config => new Config();

export const exportedForTesting = {
  Config,
};
