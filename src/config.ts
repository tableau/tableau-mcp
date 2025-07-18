import { CorsOptions } from 'cors';

import { AuthConfig } from './sdks/tableau/authConfig.js';
import { isToolName, ToolName } from './tools/toolName.js';
import { isTransport, TransportName } from './transports.js';
import invariant from './utils/invariant.js';

export class Config {
  transport: TransportName;
  httpPort: number;
  sslKey: string;
  sslCert: string;
  corsOriginConfig: CorsOptions['origin'];
  server: string;
  authConfig: AuthConfig;
  datasourceCredentials: string;
  defaultLogLevel: string;
  disableLogMasking: boolean;
  includeTools: Array<ToolName>;
  excludeTools: Array<ToolName>;
  maxResultLimit: number | null;

  constructor() {
    let { SITE_NAME: siteName } = process.env;
    const {
      TRANSPORT: transport,
      HTTP_PORT_ENV_VAR_NAME: httpPortEnvVarName,
      SERVER: server,
      SSL_KEY: sslKey,
      SSL_CERT: sslCert,
      CORS_ORIGIN_CONFIG: corsOriginConfig,
      PAT_NAME: patName,
      PAT_VALUE: patValue,
      DATASOURCE_CREDENTIALS: datasourceCredentials,
      DEFAULT_LOG_LEVEL: defaultLogLevel,
      DISABLE_LOG_MASKING: disableLogMasking,
      INCLUDE_TOOLS: includeTools,
      EXCLUDE_TOOLS: excludeTools,
      MAX_RESULT_LIMIT: maxResultLimit,
    } = process.env;

    const defaultPort = 3927;
    const httpPort = process.env[httpPortEnvVarName?.trim() || 'PORT'] || defaultPort.toString();
    const httpPortNumber = parseInt(httpPort, 10);

    siteName = siteName ?? '';
    this.transport = isTransport(transport) ? transport : 'stdio';
    this.httpPort = isNaN(httpPortNumber) ? defaultPort : httpPortNumber;
    this.sslKey = sslKey ?? '';
    this.sslCert = sslCert ?? '';
    this.corsOriginConfig = getCorsOriginConfig(corsOriginConfig ?? '');
    this.datasourceCredentials = datasourceCredentials ?? '';
    this.defaultLogLevel = defaultLogLevel ?? 'debug';
    this.disableLogMasking = disableLogMasking === 'true';

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

    invariant(patName, 'The environment variable PAT_NAME is not set');
    invariant(patValue, 'The environment variable PAT_VALUE is not set');

    this.server = server;

    this.authConfig = {
      type: 'pat',
      patName,
      patValue,
      siteName,
    };
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

  if (['true', 'false'].includes(corsOriginConfig)) {
    return corsOriginConfig === 'true';
  }

  if (corsOriginConfig === '*') {
    return '*';
  }

  if (corsOriginConfig.startsWith('[') && corsOriginConfig.endsWith(']')) {
    try {
      const origins = JSON.parse(corsOriginConfig) as Array<string>;
      return origins.map((origin) => new URL(origin).origin).filter((o) => o);
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

export const exportedForTesting = {
  Config,
};
