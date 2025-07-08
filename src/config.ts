import { isToolName, ToolName } from './tools/toolName.js';
import { isTransport, TransportName } from './transports.js';
import invariant from './utils/invariant.js';

export class Config {
  transport: TransportName;
  auth: 'pat' | 'oauth';
  httpPort: number;
  sslKey: string;
  sslCert: string;
  server: string;
  siteName: string;
  patName: string;
  patValue: string;
  datasourceCredentials: string;
  defaultLogLevel: string;
  disableLogMasking: boolean;
  oauthIssuer: string;
  redirectUri: string;
  includeTools: Array<ToolName>;
  excludeTools: Array<ToolName>;

  constructor() {
    const { SITE_NAME: siteName } = process.env;
    const {
      TRANSPORT: transport,
      AUTH: auth,
      PORT: httpPort,
      SERVER: server,
      SSL_KEY: sslKey,
      SSL_CERT: sslCert,
      PAT_NAME: patName,
      PAT_VALUE: patValue,
      DATASOURCE_CREDENTIALS: datasourceCredentials,
      DEFAULT_LOG_LEVEL: defaultLogLevel,
      DISABLE_LOG_MASKING: disableLogMasking,
      OAUTH_ISSUER: oauthIssuer,
      REDIRECT_URI: redirectUri,
      INCLUDE_TOOLS: includeTools,
      EXCLUDE_TOOLS: excludeTools,
    } = process.env;

    const defaultPort = 3927;
    const httpPortNumber = parseInt(httpPort || defaultPort.toString(), 10);

    this.siteName = siteName ?? '';
    this.auth = auth === 'pat' ? 'pat' : 'oauth';
    this.transport = isTransport(transport) ? transport : 'stdio';
    this.httpPort = isNaN(httpPortNumber) ? defaultPort : httpPortNumber;
    this.sslKey = sslKey ?? '';
    this.sslCert = sslCert ?? '';
    this.datasourceCredentials = datasourceCredentials ?? '';
    this.defaultLogLevel = defaultLogLevel ?? 'debug';
    this.disableLogMasking = disableLogMasking === 'true';
    this.oauthIssuer = oauthIssuer ?? '';
    this.redirectUri = redirectUri ?? '';

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

    if (this.auth === 'oauth') {
      invariant(oauthIssuer, 'The environment variable OAUTH_ISSUER is not set');
      invariant(redirectUri, 'The environment variable REDIRECT_URI is not set');
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

export const getConfig = (): Config => new Config();

export const exportedForTesting = {
  Config,
};
