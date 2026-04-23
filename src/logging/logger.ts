import { getConfig } from '../config.js';
import { getFileLogger } from './fileLogger.js';

export const loggerTypes = ['fileLogger', 'appLogger'] as const;
export type LoggerType = (typeof loggerTypes)[number];
const validLoggerTypes = new Set(loggerTypes);

export type LogLevel = 'debug' | 'info' | 'error';

const logLevelSeverity: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  error: 2,
};

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

type LogParams = {
  message: unknown;
  level: LogLevel;
  logger: string | undefined;
};

export function log(entry: LogParams): void {
  const config = getConfig();
  if (!shouldLog(entry.level, config.logLevel)) {
    return;
  }
  if (config.loggers.has('appLogger')) {
    const message = JSON.stringify(entry);
    if (config.transport === 'http') {
      // eslint-disable-next-line no-console -- console.log is intentional here since the transport is not stdio.
      console.log(message);
    } else {
      process.stderr.write(message.endsWith('\n') ? message : `${message}\n`);
    }
  }
  if (config.loggers.has('fileLogger')) {
    getFileLogger()?.log(entry);
  }
}
