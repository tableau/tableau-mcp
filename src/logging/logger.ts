import { getConfig } from '../config.js';
import { getFileLogger } from './fileLogger.js';
import { LogEntry, LogLevel, logLevelSeverity } from './types.js';

export const loggerTypes = ['fileLogger', 'appLogger'] as const;
export type LoggerType = (typeof loggerTypes)[number];
const validLoggerTypes = new Set(loggerTypes);

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

export function parseLoggerTypes(value: string | undefined): Set<LoggerType> {
  if (!value) {
    return new Set<LoggerType>(['appLogger']);
  }
  return new Set(
    value
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is LoggerType => validLoggerTypes.has(s as LoggerType)),
  );
}

export function log(entry: LogEntry): void {
  const config = getConfig();
  if (!shouldLog(entry.level, config.logLevel)) {
    return;
  }
  if (config.loggers.has('appLogger')) {
    // Remove data from the entry to avoid double logging.
    const { data, ...rest } = entry;
    const message = JSON.stringify(rest);
    if (config.transport === 'http') {
      if (data) {
        // eslint-disable-next-line no-console -- console.log is intentional here since the transport is not stdio.
        console.log(message, data);
      } else {
        // eslint-disable-next-line no-console -- console.log is intentional here since the transport is not stdio.
        console.log(message);
      }
    } else {
      process.stderr.write(message.endsWith('\n') ? message : `${message}\n`);
      if (data) {
        process.stderr.write(JSON.stringify(data) + '\n');
      }
    }
  }
  if (config.loggers.has('fileLogger')) {
    getFileLogger()?.log(entry);
  }
}
