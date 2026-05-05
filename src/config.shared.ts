// When the user does not provide a site name in the Claude MCP Bundle configuration,

import { join } from 'path';

import { LoggerType, parseLoggerTypes } from './logging/logger';
import { isTransport, TransportName } from './transports';

export abstract class BaseConfig {
  transport: TransportName;
  defaultLogLevel: string;
  loggers: Set<LoggerType>;
  fileLoggerDirectory: string;

  constructor() {
    const cleansedVars = removeClaudeMcpBundleUserConfigTemplates(process.env);
    const {
      TRANSPORT: transport,
      DEFAULT_LOG_LEVEL: defaultLogLevel,
      ENABLED_LOGGERS: logging,
      FILE_LOGGER_DIRECTORY: fileLoggerDirectory,
    } = cleansedVars;

    this.transport = isTransport(transport) ? transport : 'stdio';
    this.defaultLogLevel = defaultLogLevel ?? 'debug';
    this.loggers = parseLoggerTypes(logging);
    this.fileLoggerDirectory = fileLoggerDirectory || join(__dirname, 'logs');
  }
}

// Claude doesn't replace its value and sets the site name to "${user_config.site_name}".
export function removeClaudeMcpBundleUserConfigTemplates(
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
