import { BaseConfig } from '../config.shared.js';
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
  const config = new BaseConfig();
  if (!shouldLog(entry.level, config.logLevel)) {
    return;
  }
  if (config.loggers.has('appLogger')) {
    const message = JSON.stringify(entry);
    if (config.transport === 'http') {
      if ('data' in entry && entry.data) {
        // eslint-disable-next-line no-console -- console.log is intentional here since the transport is not stdio.
        console.log(message, entry.data);
      } else {
        // eslint-disable-next-line no-console -- console.log is intentional here since the transport is not stdio.
        console.log(message);
      }
    } else {
      process.stderr.write(message.endsWith('\n') ? message : `${message}\n`);
    }
  }
  if (config.loggers.has('fileLogger')) {
    getFileLogger()?.log(entry);
  }
}
