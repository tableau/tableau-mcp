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

export function log(entry: LogEntry): void {
  const config = getBaseConfig();
  if (!shouldLog(entry.level, config.logLevel)) {
    return;
  }
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
