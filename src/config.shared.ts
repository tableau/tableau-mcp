import { join } from 'path';

import { parseLogLevel } from './logging/logger.js';
import { LoggerType, parseLoggerTypes } from './logging/loggerType.js';
import { LogLevel } from './logging/types.js';
import { isTransport, TransportName } from './transports.js';
import { getDirname } from './utils/getDirname.js';
import { milliseconds } from './utils/milliseconds.js';
import { parseNumber } from './utils/parseNumber.js';

const __dirname = getDirname();

export class BaseConfig {
  transport: TransportName;
  defaultNotificationLevel: string;
  logLevel: LogLevel;
  loggers: Set<LoggerType>;
  fileLoggerDirectory: string;
  maxRequestTimeoutMs: number;
  notificationPayloadMaxBytes: number;

  constructor() {
    const cleansedVars = removeClaudeMcpBundleUserConfigTemplates(process.env);
    const {
      TRANSPORT: transport,
      DEFAULT_NOTIFICATION_LEVEL: defaultNotificationLevel,
      LOG_LEVEL: logLevel,
      ENABLED_LOGGERS: logging,
      FILE_LOGGER_DIRECTORY: fileLoggerDirectory,
      MAX_REQUEST_TIMEOUT_MS: maxRequestTimeoutMs,
      NOTIFICATION_PAYLOAD_MAX_BYTES: notificationPayloadMaxBytes,
    } = cleansedVars;

    this.transport = isTransport(transport) ? transport : 'stdio';
    this.defaultNotificationLevel = defaultNotificationLevel ?? 'debug';
    this.logLevel = parseLogLevel(logLevel);
    this.loggers = parseLoggerTypes(logging);
    this.fileLoggerDirectory = fileLoggerDirectory || join(__dirname, 'logs');
    this.maxRequestTimeoutMs = parseNumber(maxRequestTimeoutMs, {
      defaultValue: milliseconds.fromMinutes(10),
      minValue: 5000,
      maxValue: milliseconds.fromHours(1),
    });
    this.notificationPayloadMaxBytes = parseNumber(notificationPayloadMaxBytes, {
      defaultValue: 8192,
      minValue: 1,
    });
  }
}

// When the user does not provide a site name in the Claude MCP Bundle configuration,
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

export const getBaseConfig = (): BaseConfig => new BaseConfig();
