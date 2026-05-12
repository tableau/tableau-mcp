import { getConfig } from '../config.js';
import { isAxiosError } from '../utils/axios.js';
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

function sanitizeError(error: unknown): unknown {
  if (isAxiosError(error)) {
    return {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      responseData: error.response?.data,
      url: error.config?.url,
      method: error.config?.method,
    };
  }

  if (error instanceof Error) {
    return { message: error.message, name: error.name };
  }

  return error;
}

export function log(entry: LogEntry): void {
  const config = getConfig();
  if (!shouldLog(entry.level, config.logLevel)) {
    return;
  }
  if (config.loggers.has('appLogger')) {
    const message = JSON.stringify(entry);
    if (config.transport === 'http') {
      if (entry.error) {
        // eslint-disable-next-line no-console -- console.log is intentional here since the transport is not stdio.
        console.log(message, sanitizeError(entry.error));
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
