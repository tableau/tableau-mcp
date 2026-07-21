import { join } from 'path';

import { parseLogLevel } from './logging/logger.js';
import { LoggerType, parseLoggerTypes } from './logging/loggerType.js';
import { LogLevel } from './logging/types.js';
import { isTransport, TransportName } from './transports.js';
import { getDirname } from './utils/getDirname.js';
import { milliseconds } from './utils/milliseconds.js';
import { parseNumber } from './utils/parseNumber.js';

const __dirname = getDirname();

/**
 * Configuration for the scoped data-app workspace store. Limits and TTLs are transport-agnostic and
 * shared across build variants; `exposeLocalPath` is narrowed to stdio in {@link Config}.
 */
export type DataAppsConfig = {
  workspaceRoot: string;
  workspaceTtlMs: number;
  validationTtlMs: number;
  maxFileCount: number;
  maxFileBytes: number;
  maxWorkspaceBytes: number;
  exposeLocalPath: boolean;
};

export class BaseConfig {
  transport: TransportName;
  defaultNotificationLevel: string;
  logLevel: LogLevel;
  loggers: Set<LoggerType>;
  fileLoggerDirectory: string;
  disableLogMasking: boolean;
  maxRequestTimeoutMs: number;
  notificationPayloadMaxBytes: number;
  dataApps: DataAppsConfig;

  constructor() {
    const cleansedVars = removeClaudeMcpBundleUserConfigTemplates(process.env);
    const {
      TRANSPORT: transport,
      DEFAULT_NOTIFICATION_LEVEL: defaultNotificationLevel,
      LOG_LEVEL: logLevel,
      ENABLED_LOGGERS: logging,
      FILE_LOGGER_DIRECTORY: fileLoggerDirectory,
      DISABLE_LOG_MASKING: disableLogMasking,
      MAX_REQUEST_TIMEOUT_MS: maxRequestTimeoutMs,
      NOTIFICATION_PAYLOAD_MAX_BYTES: notificationPayloadMaxBytes,
      DATA_APP_WORKSPACE_ROOT: dataAppWorkspaceRoot,
      DATA_APP_WORKSPACE_TTL_MS: dataAppWorkspaceTtlMs,
      DATA_APP_VALIDATION_TTL_MS: dataAppValidationTtlMs,
      DATA_APP_MAX_FILE_COUNT: dataAppMaxFileCount,
      DATA_APP_MAX_FILE_BYTES: dataAppMaxFileBytes,
      DATA_APP_MAX_WORKSPACE_BYTES: dataAppMaxWorkspaceBytes,
      DATA_APP_EXPOSE_LOCAL_PATH: dataAppExposeLocalPath,
    } = cleansedVars;

    this.transport = isTransport(transport) ? transport : 'stdio';
    this.defaultNotificationLevel = defaultNotificationLevel ?? 'debug';
    this.logLevel = parseLogLevel(logLevel);
    this.loggers = parseLoggerTypes(logging);
    this.fileLoggerDirectory = fileLoggerDirectory || join(__dirname, 'logs');
    this.disableLogMasking = disableLogMasking === 'true';
    this.maxRequestTimeoutMs = parseNumber(maxRequestTimeoutMs, {
      defaultValue: milliseconds.fromMinutes(10),
      minValue: 5000,
      maxValue: milliseconds.fromHours(1),
    });
    this.notificationPayloadMaxBytes = parseNumber(notificationPayloadMaxBytes, {
      defaultValue: 8192,
      minValue: 1,
    });

    this.dataApps = {
      // Server-controlled root; never a caller-selected directory.
      workspaceRoot: dataAppWorkspaceRoot?.trim() || join(__dirname, 'data-app-workspaces'),
      workspaceTtlMs: parseNumber(dataAppWorkspaceTtlMs, {
        defaultValue: milliseconds.fromHours(24),
        minValue: milliseconds.fromMinutes(1),
        maxValue: milliseconds.fromDays(30),
      }),
      validationTtlMs: parseNumber(dataAppValidationTtlMs, {
        defaultValue: milliseconds.fromHours(1),
        minValue: milliseconds.fromMinutes(1),
        maxValue: milliseconds.fromDays(7),
      }),
      maxFileCount: parseNumber(dataAppMaxFileCount, {
        defaultValue: 50,
        minValue: 1,
        maxValue: 1000,
      }),
      maxFileBytes: parseNumber(dataAppMaxFileBytes, {
        defaultValue: 5 * 1024 * 1024, // 5 MiB
        minValue: 1,
        maxValue: 64 * 1024 * 1024, // 64 MiB single-request publish limit
      }),
      maxWorkspaceBytes: parseNumber(dataAppMaxWorkspaceBytes, {
        defaultValue: 32 * 1024 * 1024, // 32 MiB, comfortably under the 64 MiB publish limit
        minValue: 1,
        maxValue: 64 * 1024 * 1024,
      }),
      // Narrowed to stdio in Config; only meaningful for a single-user local server.
      exposeLocalPath: dataAppExposeLocalPath === 'true',
    };
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
