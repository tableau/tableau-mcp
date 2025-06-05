import { AuthConfig } from './sdks/tableau/authConfig.js';
import { isToolName, ToolName } from './tools/toolName.js';
import invariant from './utils/invariant.js';

class Config {
  server: string;
  authConfig: AuthConfig;
  datasourceCredentials: string;
  defaultLogLevel: string;
  disableLogMasking: boolean;
  includeTools: Array<ToolName>;
  excludeTools: Array<ToolName>;

  constructor() {
    let { SITE_NAME: siteName } = process.env;
    const {
      SERVER: server,
      PAT_NAME: patName,
      PAT_VALUE: patValue,
      DATASOURCE_CREDENTIALS: datasourceCredentials,
      DEFAULT_LOG_LEVEL: defaultLogLevel,
      DISABLE_LOG_MASKING: disableLogMasking,
      INCLUDE_TOOLS: includeTools,
      EXCLUDE_TOOLS: excludeTools,
    } = process.env;

    siteName = siteName ?? '';
    this.datasourceCredentials = datasourceCredentials ?? '';
    this.defaultLogLevel = defaultLogLevel ?? 'debug';
    this.disableLogMasking = disableLogMasking === 'true';

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

    this.server = server;

    if (patName && patValue) {
      this.authConfig = {
        type: 'pat',
        patName,
        patValue,
        siteName,
      };

      return;
    }

    throw new Error(
      'No authentication method could be determined. Ensure the environment variables are set.',
    );
  }
}

let config: Config | undefined;
export const getConfig = (): Config => {
  if (!config) {
    config = new Config();
  }

  return config;
};

export const exportedForTesting = {
  Config,
  resetConfig: () => {
    config = undefined;
  },
};
