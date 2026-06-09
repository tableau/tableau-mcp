import { getBaseConfig } from '../config.shared.js';
import { getFileLogger } from './fileLogger.js';
import { LogEntry, LogLevel, logLevelSeverity } from './types.js';

export function shouldLog(entryLevel: LogLevel, minLevel: LogLevel): boolean {
  return logLevelSeverity[entryLevel] >= logLevelSeverity[minLevel];
}

function isLogLevel(value: string): value is LogLevel {
  return value in logLevelSeverity;
}

export function parseLogLevel(value: string | undefined): LogLevel {
  const level = value?.trim();
  if (level && isLogLevel(level)) {
    return level;
  }
  return 'info';
}

/**
 * Custom JSON.stringify replacer that serializes Error objects properly.
 * Removes the config field from AxiosError to avoid logging sensitive headers.
 */
function errorReplacer(data: unknown): unknown {
  if (data instanceof Error) {
    return {
      name: data.name,
      message: data.message,
      stack: data.stack,
      ...(data.cause !== undefined && { cause: data.cause }),
    };
  }

  return data;
}

export function log(entry: LogEntry): void {
  const config = getBaseConfig();
  if (!shouldLog(entry.level, config.logLevel)) {
    return;
  }

  // we are removing any unnecessary fields that may also leak sensitive data
  entry.data = errorReplacer(entry.data);

  if (config.loggers.has('appLogger')) {
    const message = JSON.stringify(entry);
    if (config.transport === 'http') {
      // eslint-disable-next-line no-console -- console.log is intentional here since the transport is not stdio.
      console.log(message);
    } else {
      process.stderr.write(message + '\n');
    }
  }
  if (config.loggers.has('fileLogger')) {
    getFileLogger()?.log(entry);
  }
}
